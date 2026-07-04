// Client-side voice utilities: microphone recording (with silence detection),
// Gemini STT transcription, and Gemini TTS playback.

export interface RecordingResult {
  audioData: string; // base64
  mimeType: string;
}

const MIN_SPEECH_RMS = 0.006; // floor: RMS above this can count as speech
const NOISE_FLOOR_MULTIPLIER = 3; // ...and must also rise above ambient noise
const SILENCE_STOP_MS = 2000; // stop this long after speech goes quiet
const NO_SPEECH_STOP_MS = 10000; // give up if nothing was ever said
const MAX_RECORDING_MS = 60000;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/**
 * Records microphone audio until stop() is called or silence is detected
 * ("calibrated" hands-free behavior: it waits for you to finish talking).
 */
export class SpeechRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private chunks: Blob[] = [];
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private finished: Promise<RecordingResult | null>;
  private resolveFinished!: (result: RecordingResult | null) => void;

  constructor() {
    this.finished = new Promise(resolve => { this.resolveFinished = resolve; });
  }

  /** True once the recorder heard something above the noise floor. */
  speechDetected = false;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = preferredTypes.find(t => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.onstop = async () => {
      this.cleanup();
      const type = this.recorder?.mimeType || mimeType || 'audio/webm';
      const blob = new Blob(this.chunks, { type });
      if (blob.size < 1000) {
        this.resolveFinished(null); // effectively empty recording
        return;
      }
      this.resolveFinished({
        audioData: await blobToBase64(blob),
        // Strip codec params; the API just needs the container type.
        mimeType: type.split(';')[0],
      });
    };

    this.startSilenceMonitor();
    this.recorder.start();
  }

  /** Stops recording; the promise from waitForResult() resolves with the audio. */
  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.recorder.stop();
    } else {
      this.cleanup();
      this.resolveFinished(null);
    }
  }

  waitForResult(): Promise<RecordingResult | null> {
    return this.finished;
  }

  private startSilenceMonitor(): void {
    if (!this.stream) return;
    try {
      this.audioContext = new AudioContext();
      // Auto-listen (hands-free loop) runs outside a click; make sure the
      // monitoring context is actually running or RMS reads as pure zeros.
      if (this.audioContext.state === 'suspended') {
        this.audioContext.resume().catch(() => {});
      }
      const source = this.audioContext.createMediaStreamSource(this.stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const samples = new Float32Array(analyser.fftSize);
      const startedAt = Date.now();
      let quietSince: number | null = null;
      // Adaptive noise floor so quiet mics and noisy rooms both work: speech
      // must rise clearly above the ambient level, not a fixed threshold.
      let noiseFloor = 0.003;

      this.monitorInterval = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
        const rms = Math.sqrt(sum / samples.length);
        const now = Date.now();

        const speechThreshold = Math.max(MIN_SPEECH_RMS, noiseFloor * NOISE_FLOOR_MULTIPLIER);
        if (rms >= speechThreshold) {
          this.speechDetected = true;
          quietSince = null;
        } else {
          noiseFloor = noiseFloor * 0.95 + rms * 0.05;
          if (quietSince === null) quietSince = now;
        }

        const quietFor = quietSince === null ? 0 : now - quietSince;
        const shouldStop =
          (this.speechDetected && quietFor >= SILENCE_STOP_MS) ||
          (!this.speechDetected && now - startedAt >= NO_SPEECH_STOP_MS) ||
          now - startedAt >= MAX_RECORDING_MS;

        if (shouldStop) this.stop();
      }, 120);
    } catch (e) {
      // Silence detection is best-effort; manual stop still works without it.
      console.warn('Silence detection unavailable:', e);
    }
  }

  private cleanup(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }
}

/** Sends recorded audio to the server for Gemini STT transcription. */
export const transcribeAudio = async (recording: RecordingResult): Promise<string> => {
  const response = await fetch('/api/stt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recording),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || 'Transcription failed.');
  }
  const { transcript } = await response.json() as { transcript: string };
  return transcript.trim();
};

// --- Text-to-speech playback (single shared player so voices never overlap) ---

let currentAudio: HTMLAudioElement | null = null;

export const stopSpeaking = (): void => {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
};

/**
 * Converts text to speech via Gemini TTS and plays it.
 * Resolves when playback finishes (or is stopped/interrupted).
 */
export const speak = async (text: string): Promise<void> => {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || 'Text-to-speech failed.');
  }
  const { audioData, mimeType } = await response.json() as { audioData: string; mimeType: string };

  stopSpeaking();
  const audio = new Audio(`data:${mimeType};base64,${audioData}`);
  currentAudio = audio;

  await new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.onpause = () => resolve(); // covers stopSpeaking() interruptions
    audio.play().catch(() => resolve());
  });

  if (currentAudio === audio) currentAudio = null;
};

const CHORD_PATTERN = /^[A-G][#b]?(?:maj|min|m|M|dim|aug|sus|add)?\d{0,2}(?:\/[A-G][#b]?)?$/;
const MAX_SPEECH_CHARS = 4000;

/** Converts chat Markdown into clean, natural text for the TTS voice. */
export const prepareTextForSpeech = (markdown: string): string => {
  let text = markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1')
    // Bracketed tokens: drop chord symbols like [G] or [Em7], keep section
    // labels like [Verse 1] as spoken text.
    .replace(/\[([^\]\n]{1,20})\]/g, (match, inner) => (CHORD_PATTERN.test(inner.trim()) ? ' ' : `${inner}. `))
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/[*_`>|~]/g, ' ')
    .replace(/^\s*[-•]\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length > MAX_SPEECH_CHARS) {
    const cutoff = text.lastIndexOf('.', MAX_SPEECH_CHARS);
    text = text.slice(0, cutoff > MAX_SPEECH_CHARS / 2 ? cutoff + 1 : MAX_SPEECH_CHARS);
  }
  return text;
};
