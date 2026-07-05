// Streaming PCM playback engine for Jam Mode.
// Lyria RealTime sends raw 16-bit PCM, 48kHz, stereo, base64-encoded. Chunks
// are decoded and scheduled back-to-back on a Web Audio timeline with a small
// jitter buffer so network hiccups don't cause gaps.

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
// Streaming ~2.5s ahead absorbs network jitter AND bridges hard transitions:
// when BPM/key changes reset the model's context, the buffered audio keeps
// playing while fresh chunks arrive, so there's no silent gap.
const JITTER_BUFFER_SECONDS = 2.5;

export class JamAudioPlayer {
  private context: AudioContext;
  private gain: GainNode;
  private analyser: AnalyserNode;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor() {
    this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.gain = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.gain.connect(this.analyser);
    this.analyser.connect(this.context.destination);
  }

  /** Decodes a base64 PCM16 stereo chunk and schedules it for gapless playback. */
  enqueueChunk(base64Data: string): void {
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const samples = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));

    const frameCount = Math.floor(samples.length / CHANNELS);
    if (frameCount === 0) return;

    const buffer = this.context.createBuffer(CHANNELS, frameCount, SAMPLE_RATE);
    for (let channel = 0; channel < CHANNELS; channel++) {
      const channelData = buffer.getChannelData(channel);
      for (let frame = 0; frame < frameCount; frame++) {
        channelData[frame] = samples[frame * CHANNELS + channel] / 32768;
      }
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    this.sources.add(source);
    source.onended = () => this.sources.delete(source);

    const now = this.context.currentTime;
    // First chunk (or after a stall): start behind a jitter buffer.
    if (this.nextStartTime < now) {
      this.nextStartTime = now + JITTER_BUFFER_SECONDS;
    }
    source.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
  }

  /** Drops all queued audio (used on pause/stop and on hard transitions). */
  flush(): void {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* already stopped */ }
    }
    this.sources.clear();
    this.nextStartTime = 0;
  }

  async resume(): Promise<void> {
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async suspend(): Promise<void> {
    if (this.context.state === 'running') await this.context.suspend();
  }

  setVolume(volume: number): void {
    this.gain.gain.setTargetAtTime(Math.min(Math.max(volume, 0), 1), this.context.currentTime, 0.05);
  }

  /** Fills `target` with current time-domain waveform data for visualization. */
  getWaveform(target: Uint8Array): void {
    this.analyser.getByteTimeDomainData(target as Uint8Array<ArrayBuffer>);
  }

  get waveformBinCount(): number {
    return this.analyser.frequencyBinCount;
  }

  /** Seconds of audio currently buffered ahead of the playhead. */
  get bufferAheadSeconds(): number {
    return Math.max(0, this.nextStartTime - this.context.currentTime);
  }

  async close(): Promise<void> {
    this.flush();
    if (this.context.state !== 'closed') await this.context.close();
  }
}
