// WebSocket client for Jam Mode. Talks to our server proxy at /api/jam, which
// holds the Lyria RealTime session; see server.ts for the message protocol.

export interface JamPrompt {
  id: string;
  text: string;
  weight: number; // 0..2 slider; sent only when > 0 and not muted
  muted: boolean;
  color: string;
  filteredReason?: string; // set when the safety filter rejected this prompt
}

export interface JamConfig {
  density?: number; // 0..1 (undefined = model decides)
  brightness?: number; // 0..1
  temperature: number; // "Chaos", 0..3
  bpm?: number; // 60..200 (undefined = model decides)
  scale: string; // Scale enum value or 'SCALE_UNSPECIFIED'
  muteDrums: boolean;
  muteBass: boolean;
  muteOther: boolean; // maps to onlyBassAndDrums
}

export interface JamSessionCallbacks {
  onReady: () => void;
  onAudioChunk: (base64Data: string) => void;
  onFilteredPrompt: (text: string, reason: string) => void;
  onError: (message: string) => void;
  onEnded: (reason?: string) => void;
  onShared: (path: string) => void;
  onShareError: (message: string) => void;
  onDisconnect: () => void;
}

export class JamSession {
  private ws: WebSocket | null = null;
  private callbacks: JamSessionCallbacks;

  constructor(callbacks: JamSessionCallbacks) {
    this.callbacks = callbacks;
  }

  connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${protocol}://${window.location.host}/api/jam`);

    this.ws.onmessage = (event) => {
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'ready': this.callbacks.onReady(); break;
        case 'audio': this.callbacks.onAudioChunk(msg.data); break;
        case 'filtered': this.callbacks.onFilteredPrompt(msg.text, msg.reason); break;
        case 'error': this.callbacks.onError(msg.message); break;
        case 'ended': this.callbacks.onEnded(msg.reason); break;
        case 'shared': this.callbacks.onShared(msg.path); break;
        case 'share-error': this.callbacks.onShareError(msg.message); break;
      }
    };
    this.ws.onclose = () => this.callbacks.onDisconnect();
    this.ws.onerror = () => this.callbacks.onError('Connection to the jam server was interrupted.');
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  /** Sends the active (non-muted, weight > 0) prompts to steer the music. */
  sendPrompts(prompts: JamPrompt[]): void {
    const active = prompts
      .filter(p => !p.muted && p.weight > 0.01 && !p.filteredReason)
      .map(p => ({ text: p.text, weight: p.weight }));
    if (active.length > 0) {
      this.send({ type: 'prompts', prompts: active });
    }
  }

  /** Sends the full generation config; reset=true forces a hard transition (BPM/key). */
  sendConfig(config: JamConfig, reset = false): void {
    this.send({
      type: 'config',
      reset,
      config: {
        density: config.density,
        brightness: config.brightness,
        temperature: config.temperature,
        bpm: config.bpm,
        scale: config.scale !== 'SCALE_UNSPECIFIED' ? config.scale : undefined,
        muteDrums: config.muteDrums,
        muteBass: config.muteBass,
        onlyBassAndDrums: config.muteOther,
      },
    });
  }

  play(): void { this.send({ type: 'play' }); }
  pause(): void { this.send({ type: 'pause' }); }
  stop(): void { this.send({ type: 'stop' }); }
  share(): void { this.send({ type: 'share' }); }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export const JAM_SCALES: { value: string; label: string }[] = [
  { value: 'SCALE_UNSPECIFIED', label: 'Auto' },
  { value: 'C_MAJOR_A_MINOR', label: 'C maj / A min' },
  { value: 'D_FLAT_MAJOR_B_FLAT_MINOR', label: 'D♭ maj / B♭ min' },
  { value: 'D_MAJOR_B_MINOR', label: 'D maj / B min' },
  { value: 'E_FLAT_MAJOR_C_MINOR', label: 'E♭ maj / C min' },
  { value: 'E_MAJOR_D_FLAT_MINOR', label: 'E maj / C♯ min' },
  { value: 'F_MAJOR_D_MINOR', label: 'F maj / D min' },
  { value: 'G_FLAT_MAJOR_E_FLAT_MINOR', label: 'G♭ maj / E♭ min' },
  { value: 'G_MAJOR_E_MINOR', label: 'G maj / E min' },
  { value: 'A_FLAT_MAJOR_F_MINOR', label: 'A♭ maj / F min' },
  { value: 'A_MAJOR_G_FLAT_MINOR', label: 'A maj / F♯ min' },
  { value: 'B_FLAT_MAJOR_G_MINOR', label: 'B♭ maj / G min' },
  { value: 'B_MAJOR_A_FLAT_MINOR', label: 'B maj / G♯ min' },
];

// Suggestion chips drawn from the official Lyria RealTime prompt guide.
export const JAM_SUGGESTIONS: string[] = [
  'Disco Funk', 'Drumline', 'Tabla', 'Oud', 'Grime', 'Psychedelic', '60s Soul',
  'Warm Acoustic Guitar', 'Boomy Bass', 'Harmonica', 'Indie Pop', 'Delta Blues', 'Fiddle',
  'Lo-Fi Hip Hop', 'Minimal Techno', 'Bluegrass', 'Jazz Fusion', 'Reggaeton', 'Synthpop',
  '303 Acid Bass', 'Rhodes Piano', 'Steel Drum', 'Sitar', 'Marimba', 'Moog Oscillations',
  'Deep House', 'Afrobeat', 'Bossa Nova', 'Trap Beat', 'Celtic Folk', 'Chiptune',
  'Dreamy', 'Funky', 'Chill', 'Danceable', 'Upbeat', 'Ethereal Ambience', 'Tight Groove',
  'Smooth Pianos', 'Spacey Synths', 'Funk Drums', 'Salsa', 'Surf Rock', 'Ominous Drone',
];

export const JAM_PROMPT_COLORS = [
  '#f5c2e7', '#94e2d5', '#b4befe', '#89b4fa', '#a6e3a1',
  '#fab387', '#cba6f7', '#f9e2af', '#eba0ac', '#74c7ec',
];
