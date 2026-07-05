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
}

export interface JamSessionCallbacks {
  onReady: () => void;
  onAudioChunk: (base64Data: string) => void;
  onFilteredPrompt: (text: string, reason: string) => void;
  onError: (message: string) => void;
  onEnded: (reason?: string, upsell?: boolean) => void;
  onShared: (path: string) => void;
  onShareError: (message: string) => void;
  onDisconnect: () => void;
  onSessionLimit?: (minutes: number) => void;
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
        case 'ended': this.callbacks.onEnded(msg.reason, !!msg.upsell); break;
        case 'shared': this.callbacks.onShared(msg.path); break;
        case 'share-error': this.callbacks.onShareError(msg.message); break;
        case 'session-limit': this.callbacks.onSessionLimit?.(msg.minutes); break;
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

  /** Authenticates the session (signed-in users get longer jam limits). */
  sendAuth(token: string): void {
    this.send({ type: 'auth', token });
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

// Instrument and style catalogs from the official Lyria RealTime prompt guide.
export const JAM_INSTRUMENTS: string[] = [
  '303 Acid Bass', '808 Hip Hop Beat', 'Accordion', 'Alto Saxophone', 'Bagpipes',
  'Balalaika Ensemble', 'Banjo', 'Bass Clarinet', 'Bongos', 'Boomy Bass', 'Bouzouki',
  'Buchla Synths', 'Cello', 'Charango', 'Clavichord', 'Conga Drums', 'Didgeridoo',
  'Dirty Synths', 'Djembe', 'Drumline', 'Dulcimer', 'Fiddle', 'Flamenco Guitar',
  'Funk Drums', 'Glockenspiel', 'Guitar', 'Hang Drum', 'Harmonica', 'Harp',
  'Harpsichord', 'Hurdy-gurdy', 'Kalimba', 'Koto', 'Lyre', 'Mandolin', 'Maracas',
  'Marimba', 'Mbira', 'Mellotron', 'Metallic Twang', 'Moog Oscillations', 'Ocarina',
  'Persian Tar', 'Pipa', 'Precision Bass', 'Ragtime Piano', 'Rhodes Piano', 'Shamisen',
  'Shredding Guitar', 'Sitar', 'Slide Guitar', 'Smooth Pianos', 'Spacey Synths',
  'Steel Drum', 'Synth Pads', 'Tabla', 'TR-909 Drum Machine', 'Trumpet', 'Tuba',
  'Vibraphone', 'Viola Ensemble', 'Warm Acoustic Guitar', 'Woodwinds',
];

export const JAM_STYLES: string[] = [
  'Acid Jazz', 'Afrobeat', 'Alternative Country', 'Baroque', 'Bengal Baul', 'Bhangra',
  'Bluegrass', 'Blues Rock', 'Bossa Nova', 'Breakbeat', 'Celtic Folk', 'Chillout',
  'Chiptune', 'Classic Rock', 'Contemporary R&B', 'Cumbia', 'Deep House', 'Disco Funk',
  'Drum & Bass', 'Dubstep', 'EDM', 'Electro Swing', 'Funk Metal', 'G-funk',
  'Garage Rock', 'Glitch Hop', 'Grime', 'Hyperpop', 'Indian Classical',
  'Indie Electronic', 'Indie Folk', 'Indie Pop', 'Irish Folk', 'Jam Band',
  'Jamaican Dub', 'Jazz Fusion', 'Latin Jazz', 'Lo-Fi Hip Hop', 'Marching Band',
  'Merengue', 'Minimal Techno', 'Moombahton', 'Neo-Soul', 'New Jack Swing',
  'Orchestral Score', 'Piano Ballad', 'Polka', 'Post-Punk', '60s Psychedelic Rock',
  'Psytrance', 'R&B', 'Reggae', 'Reggaeton', 'Renaissance Music', 'Salsa', 'Shoegaze',
  'Ska', 'Surf Rock', 'Synthpop', 'Techno', 'Trance', 'Trap Beat', 'Trip Hop',
  'Vaporwave', 'Witch House',
];

export const JAM_PROMPT_COLORS = [
  '#f5c2e7', '#94e2d5', '#b4befe', '#89b4fa', '#a6e3a1',
  '#fab387', '#cba6f7', '#f9e2af', '#eba0ac', '#74c7ec',
];
