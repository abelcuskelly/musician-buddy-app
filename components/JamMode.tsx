import React, { useState, useEffect, useRef, useCallback } from 'react';
import { JamSession, JamPrompt, JamConfig, JAM_SCALES, JAM_SUGGESTIONS, JAM_PROMPT_COLORS } from '../lib/jamSession.ts';
import { JamAudioPlayer } from '../lib/jamAudio.ts';
import { copyToClipboard } from '../lib/share.ts';
import CloseIcon from './icons/CloseIcon.tsx';
import InfoIcon from './icons/InfoIcon.tsx';
import PlayIcon from './icons/PlayIcon.tsx';
import PauseIcon from './icons/PauseIcon.tsx';
import TrashIcon from './icons/TrashIcon.tsx';
import ShareIcon from './icons/ShareIcon.tsx';
import VolumeIcon from './icons/VolumeIcon.tsx';
import CheckIcon from './icons/CheckIcon.tsx';

interface JamModeProps {
  onEndJam: () => void;
}

type JamStatus = 'connecting' | 'ready' | 'playing' | 'paused' | 'ended' | 'error';

const DEFAULT_CONFIG: JamConfig = {
  density: undefined,
  brightness: undefined,
  temperature: 1.1,
  bpm: undefined,
  scale: 'SCALE_UNSPECIFIED',
  muteDrums: false,
  muteBass: false,
  muteOther: false,
};

const JAM_CONTROLS_INFO: { name: string; description: string }[] = [
  { name: 'Add a Prompt', description: 'Add a musical instrument, genre, mood, etc. as a slider — blend up to 10 to shape the jam.' },
  { name: 'Density', description: 'Make the music smooth or punchy.' },
  { name: 'Brightness', description: 'Adjust the tone.' },
  { name: 'Chaos', description: 'Make the music random or repetitive.' },
  { name: 'Drums, bass, and other', description: 'Mute specific instruments.' },
  { name: 'BPM', description: 'Set the tempo (restarts the music).' },
  { name: 'Key', description: 'Set the key center (restarts the music).' },
  { name: 'Share', description: 'Shares a URL with the last minute of your jam.' },
];

let promptIdCounter = 0;
const makePrompt = (text: string, weight = 1.0): JamPrompt => ({
  id: `jp-${++promptIdCounter}`,
  text,
  weight,
  muted: false,
  color: JAM_PROMPT_COLORS[promptIdCounter % JAM_PROMPT_COLORS.length],
});

const shuffle = <T,>(items: T[]): T[] => [...items].sort(() => Math.random() - 0.5);

const JamMode: React.FC<JamModeProps> = ({ onEndJam }) => {
  const [status, setStatus] = useState<JamStatus>('connecting');
  const [prompts, setPrompts] = useState<JamPrompt[]>(() => [
    makePrompt('Warm Acoustic Guitar', 1.2),
    makePrompt('Indie Pop', 1.0),
  ]);
  const [config, setConfig] = useState<JamConfig>(DEFAULT_CONFIG);
  const [newPromptText, setNewPromptText] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>(() => shuffle(JAM_SUGGESTIONS).slice(0, 8));
  const [volume, setVolume] = useState(0.9);
  const [notice, setNotice] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isBpmOpen, setIsBpmOpen] = useState(false);
  const [pendingBpm, setPendingBpm] = useState(120);
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied'>('idle');

  const sessionRef = useRef<JamSession | null>(null);
  const playerRef = useRef<JamAudioPlayer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const promptsRef = useRef(prompts);
  promptsRef.current = prompts;
  const configRef = useRef(config);
  configRef.current = config;
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Session lifecycle ---
  useEffect(() => {
    const session = new JamSession({
      onReady: () => {
        session.sendPrompts(promptsRef.current);
        session.sendConfig(configRef.current);
        setStatus('ready');
      },
      onAudioChunk: (data) => {
        playerRef.current?.enqueueChunk(data);
      },
      onFilteredPrompt: (text, reason) => {
        setPrompts(prev => prev.map(p => p.text.toLowerCase() === text.toLowerCase() ? { ...p, filteredReason: reason } : p));
        setNotice(`"${text}" was skipped by the music safety filter${reason ? `: ${reason}` : ''}. (Tip: describe sounds and styles rather than artist names.)`);
      },
      onError: (message) => setNotice(message),
      onEnded: (reason) => {
        setEndedReason(reason || 'The jam session ended.');
        setStatus('ended');
        playerRef.current?.flush();
      },
      onShared: async (sharePath) => {
        const url = `${window.location.origin}${sharePath}`;
        try {
          await copyToClipboard(url);
          setShareState('copied');
        } catch {
          window.prompt('Copy your jam link:', url);
          setShareState('idle');
          return;
        }
        setTimeout(() => setShareState('idle'), 2500);
      },
      onShareError: (message) => {
        setShareState('idle');
        setNotice(message);
      },
      onDisconnect: () => {
        if (statusRef.current !== 'ended') {
          setEndedReason('Connection to the jam server was lost.');
          setStatus('ended');
        }
      },
    });
    sessionRef.current = session;
    session.connect();

    return () => {
      session.close();
      playerRef.current?.close();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- Waveform visualization ---
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const player = playerRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);
      if (!player) return;
      const data = new Uint8Array(player.waveformBinCount);
      player.getWaveform(data);
      ctx.beginPath();
      ctx.strokeStyle = '#89b4fa';
      ctx.lineWidth = 1.5;
      const slice = width / data.length;
      for (let i = 0; i < data.length; i++) {
        const y = (data[i] / 255) * height;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * slice, y);
      }
      ctx.stroke();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  // --- Steering (debounced sends on prompt/config changes) ---
  const queueSend = useCallback((sendConfigToo: boolean, reset = false) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      sessionRef.current?.sendPrompts(promptsRef.current);
      if (sendConfigToo) sessionRef.current?.sendConfig(configRef.current, reset);
    }, 250);
  }, []);

  const updatePrompt = (id: string, updates: Partial<JamPrompt>) => {
    setPrompts(prev => prev.map(p => (p.id === id ? { ...p, ...updates, ...(updates.text ? { filteredReason: undefined } : {}) } : p)));
    queueSend(false);
  };

  const removePrompt = (id: string) => {
    setPrompts(prev => prev.filter(p => p.id !== id));
    queueSend(false);
  };

  const addPrompt = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || promptsRef.current.length >= 10) return;
    if (promptsRef.current.some(p => p.text.toLowerCase() === trimmed.toLowerCase())) return;
    setPrompts(prev => [...prev, makePrompt(trimmed)]);
    setNewPromptText('');
    queueSend(false);
  };

  const updateConfig = (updates: Partial<JamConfig>, reset = false) => {
    const next = { ...configRef.current, ...updates };
    configRef.current = next;
    setConfig(next);
    if (reset) {
      // BPM/key changes apply immediately with a context reset (hard transition).
      sessionRef.current?.sendConfig(next, true);
      playerRef.current?.flush();
    } else {
      queueSend(true);
    }
  };

  // --- Transport ---
  const handlePlayPause = async () => {
    if (status === 'playing') {
      sessionRef.current?.pause();
      await playerRef.current?.suspend();
      setStatus('paused');
      return;
    }
    // Create the audio player inside a user gesture (browser autoplay policy).
    if (!playerRef.current) {
      playerRef.current = new JamAudioPlayer();
      playerRef.current.setVolume(volume);
    }
    await playerRef.current.resume();
    sessionRef.current?.play();
    setStatus('playing');
  };

  const handleVolume = (value: number) => {
    setVolume(value);
    playerRef.current?.setVolume(value);
  };

  const handleShare = () => {
    if (shareState !== 'idle') return;
    setShareState('sharing');
    sessionRef.current?.share();
  };

  const handleEndJam = () => {
    sessionRef.current?.close();
    playerRef.current?.close();
    playerRef.current = null;
    onEndJam();
  };

  const activeCount = prompts.filter(p => !p.muted && !p.filteredReason).length;

  return (
    <div className="min-h-screen bg-[#0a0a12] flex flex-col items-center">
      <div className="w-full max-w-3xl flex flex-col h-screen">
        {/* Header */}
        <header className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <img src="/jam-buddy-logo.png" alt="Jam Buddy logo" className="w-10 h-10 rounded-lg" />
            <h1 className="text-xl font-bold text-[#cdd6f4]">Jam Mode</h1>
            <button
              onClick={() => setIsInfoOpen(true)}
              className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-[#cdd6f4] transition-colors"
              aria-label="Jam Controls info"
              title="Jam Controls"
            >
              <InfoIcon className="w-5 h-5" />
            </button>
          </div>
          <button
            onClick={handleEndJam}
            className="px-4 py-2 rounded-lg bg-gradient-to-br from-[#f38ba8] to-[#eba0ac] text-gray-900 font-semibold hover:opacity-90 transition-opacity"
          >
            End Jam
          </button>
        </header>

        {notice && (
          <div className="mx-4 mb-2 px-4 py-2.5 rounded-lg bg-[#f9e2af]/10 border border-[#f9e2af]/30 text-[#f9e2af] text-sm flex items-start justify-between gap-3">
            <span>{notice}</span>
            <button onClick={() => setNotice(null)} aria-label="Dismiss notice" className="flex-shrink-0 hover:text-white transition-colors">
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Prompt mixer */}
        <main className="flex-1 overflow-y-auto px-4 space-y-3 pb-4">
          {prompts.map((prompt) => (
            <div key={prompt.id} className={`rounded-xl p-3 bg-[#181825] border border-gray-700/40 ${prompt.filteredReason ? 'opacity-60' : ''}`}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.01}
                value={prompt.muted ? 0 : prompt.weight}
                disabled={prompt.muted || !!prompt.filteredReason}
                onChange={(e) => updatePrompt(prompt.id, { weight: parseFloat(e.target.value) })}
                className="jam-slider w-full"
                style={{ ['--slider-color' as any]: prompt.color }}
                aria-label={`Weight for ${prompt.text}`}
              />
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-sm font-semibold" style={{ color: prompt.color }}>
                  {prompt.text.toLowerCase()}
                  {prompt.filteredReason && <span className="ml-2 text-xs text-[#f38ba8] font-normal">blocked by safety filter</span>}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => removePrompt(prompt.id)}
                    className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-[#f38ba8] transition-colors"
                    aria-label={`Remove ${prompt.text}`}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => updatePrompt(prompt.id, { muted: !prompt.muted })}
                    className={`p-1.5 rounded-full hover:bg-white/10 transition-colors ${prompt.muted ? 'text-[#f38ba8]' : 'text-gray-400 hover:text-[#cdd6f4]'}`}
                    aria-label={prompt.muted ? `Unmute ${prompt.text}` : `Mute ${prompt.text}`}
                  >
                    <VolumeIcon className="w-4 h-4" muted={prompt.muted} />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Add prompt */}
          <form
            onSubmit={(e) => { e.preventDefault(); addPrompt(newPromptText); }}
            className="flex items-center gap-2 bg-[#181825] border border-gray-700/40 rounded-xl px-4 py-2.5"
          >
            <input
              type="text"
              value={newPromptText}
              onChange={(e) => setNewPromptText(e.target.value)}
              placeholder={prompts.length >= 10 ? 'Max 10 prompts — remove one to add more' : 'Add a prompt ...'}
              disabled={prompts.length >= 10}
              className="flex-1 bg-transparent text-[#cdd6f4] placeholder:text-gray-500 focus:outline-none text-sm"
              aria-label="Add a prompt"
            />
            <button
              type="submit"
              disabled={!newPromptText.trim() || prompts.length >= 10}
              className="px-3 py-1 rounded-lg bg-[#313244] hover:bg-[#45475a] text-[#89b4fa] text-xs font-semibold transition-colors disabled:opacity-40"
            >
              Add
            </button>
          </form>

          {/* Suggestion chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setSuggestions(shuffle(JAM_SUGGESTIONS).slice(0, 8))}
              className="px-3 py-1.5 rounded-full bg-[#313244] hover:bg-[#45475a] text-[#cdd6f4] text-xs font-medium transition-colors"
            >
              ↻ more
            </button>
            {suggestions.map(s => (
              <button
                key={s}
                onClick={() => addPrompt(s)}
                disabled={prompts.length >= 10}
                className="px-3 py-1.5 rounded-full bg-[#181825] border border-gray-700/50 hover:border-[#89b4fa]/60 text-gray-300 text-xs transition-colors disabled:opacity-40"
              >
                {s.toLowerCase()}
              </button>
            ))}
          </div>
        </main>

        {/* Control dock */}
        <footer className="bg-[#11111b] border-t border-gray-700/40 rounded-t-3xl px-5 pt-4 pb-5 space-y-4">
          <div className="grid grid-cols-3 gap-4">
            {([
              { label: 'Density', key: 'density', min: 0, max: 1, step: 0.01, value: config.density ?? 0.5 },
              { label: 'Brightness', key: 'brightness', min: 0, max: 1, step: 0.01, value: config.brightness ?? 0.5 },
              { label: 'Chaos', key: 'temperature', min: 0, max: 3, step: 0.05, value: config.temperature },
            ] as const).map(ctl => (
              <div key={ctl.key} className="text-center">
                <input
                  type="range"
                  min={ctl.min}
                  max={ctl.max}
                  step={ctl.step}
                  value={ctl.value}
                  onChange={(e) => updateConfig({ [ctl.key]: parseFloat(e.target.value) } as Partial<JamConfig>)}
                  className="jam-slider w-full"
                  style={{ ['--slider-color' as any]: '#cdd6f4' }}
                  aria-label={ctl.label}
                />
                <span className="text-xs text-gray-400 mt-1 block">{ctl.label}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-2">
            {([
              { label: 'Drums', key: 'muteDrums' },
              { label: 'Bass', key: 'muteBass' },
              { label: 'Other', key: 'muteOther' },
            ] as const).map(m => (
              <button
                key={m.key}
                onClick={() => updateConfig({ [m.key]: !config[m.key] } as Partial<JamConfig>)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  config[m.key] ? 'bg-[#f38ba8]/20 text-[#f38ba8]' : 'bg-[#313244] text-[#a6e3a1] hover:bg-[#45475a]'
                }`}
                aria-pressed={config[m.key]}
                title={config[m.key] ? `Unmute ${m.label.toLowerCase()}` : `Mute ${m.label.toLowerCase()}`}
              >
                <VolumeIcon className="w-3.5 h-3.5" muted={config[m.key]} />
                {m.label}
              </button>
            ))}
          </div>

          {/* Transport bar */}
          <div className="flex items-center flex-wrap justify-center gap-3 bg-[#181825] rounded-3xl px-4 py-2.5 border border-gray-700/40">
            <button
              onClick={handlePlayPause}
              disabled={status === 'connecting' || status === 'ended' || activeCount === 0}
              className="w-11 h-11 rounded-full bg-gradient-to-br from-[#f5c2e7] to-[#cba6f7] text-gray-900 flex items-center justify-center hover:opacity-90 transition-opacity disabled:opacity-40 flex-shrink-0"
              aria-label={status === 'playing' ? 'Pause' : 'Play'}
            >
              {status === 'playing' ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 ml-0.5" />}
            </button>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              <VolumeIcon className="w-4 h-4 text-gray-400" />
              <input
                type="range" min={0} max={1} step={0.01} value={volume}
                onChange={(e) => handleVolume(parseFloat(e.target.value))}
                className="jam-slider w-16"
                style={{ ['--slider-color' as any]: '#89b4fa' }}
                aria-label="Volume"
              />
            </div>

            <canvas ref={canvasRef} width={400} height={36} className="flex-1 basis-24 min-w-0 h-9" aria-hidden="true" />

            <div className="relative flex-shrink-0">
              <button
                onClick={() => { setPendingBpm(config.bpm ?? 120); setIsBpmOpen(!isBpmOpen); }}
                className="px-2.5 py-1.5 rounded-lg bg-[#313244] hover:bg-[#45475a] text-[#cdd6f4] text-xs font-bold transition-colors"
                aria-label="Set BPM (restarts the music)"
              >
                BPM<br />{config.bpm ?? 'auto'}
              </button>
              {isBpmOpen && (
                <div className="absolute bottom-full right-0 mb-2 bg-[#1e1e2e] border border-gray-700/50 rounded-xl p-4 w-56 shadow-xl z-20">
                  <p className="text-xs text-gray-400 mb-2">Tempo: <span className="text-[#cdd6f4] font-bold">{pendingBpm} BPM</span> <span className="text-gray-500">(restarts the music)</span></p>
                  <input
                    type="range" min={60} max={200} step={1} value={pendingBpm}
                    onChange={(e) => setPendingBpm(parseInt(e.target.value, 10))}
                    className="jam-slider w-full"
                    style={{ ['--slider-color' as any]: '#89b4fa' }}
                    aria-label="BPM value"
                  />
                  <button
                    onClick={() => { updateConfig({ bpm: pendingBpm }, true); setIsBpmOpen(false); }}
                    className="w-full mt-3 px-3 py-1.5 rounded-lg bg-gradient-to-br from-[#89b4fa] to-[#b4befe] text-gray-900 text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    Apply
                  </button>
                </div>
              )}
            </div>

            <select
              value={config.scale}
              onChange={(e) => updateConfig({ scale: e.target.value }, true)}
              className="bg-[#313244] hover:bg-[#45475a] text-[#cdd6f4] text-xs font-bold rounded-lg px-2 py-2 focus:outline-none appearance-none flex-shrink-0 cursor-pointer"
              aria-label="Set key (restarts the music)"
              title="Key (restarts the music)"
            >
              {JAM_SCALES.map(s => <option key={s.value} value={s.value}>{s.value === 'SCALE_UNSPECIFIED' ? 'KEY' : s.label}</option>)}
            </select>

            <button
              onClick={handleShare}
              disabled={status === 'connecting' || status === 'ended' || shareState === 'sharing'}
              className={`p-2.5 rounded-full transition-colors flex-shrink-0 ${
                shareState === 'copied' ? 'bg-[#a6e3a1]/20 text-[#a6e3a1]' : 'bg-[#313244] hover:bg-[#45475a] text-[#94e2d5]'
              } disabled:opacity-40`}
              aria-label="Share the last minute of your jam"
              title={shareState === 'copied' ? 'Link copied!' : 'Share the last minute of your jam'}
            >
              {shareState === 'copied' ? <CheckIcon className="w-4 h-4" /> : <ShareIcon className="w-4 h-4" />}
            </button>
          </div>

          <p className="text-center text-xs text-gray-500">
            {status === 'connecting' && 'Connecting to the jam server...'}
            {status === 'ready' && 'Ready — press play to start the music, then steer it live.'}
            {status === 'playing' && 'Live — tweak prompts and controls to steer the jam in real time.'}
            {status === 'paused' && 'Paused.'}
            {status === 'ended' && (endedReason ?? 'Jam ended.')}
          </p>
        </footer>
      </div>

      {/* Ended overlay */}
      {status === 'ended' && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-40 p-4">
          <div className="bg-[#1e1e2e] rounded-2xl border border-gray-700/50 p-8 max-w-md text-center">
            <h2 className="text-xl font-bold text-[#cdd6f4] mb-2">Jam ended</h2>
            <p className="text-sm text-gray-400 mb-6">{endedReason}</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 rounded-lg bg-gradient-to-br from-[#89b4fa] to-[#b4befe] text-gray-900 font-semibold hover:opacity-90 transition-opacity"
              >
                Start a New Jam
              </button>
              <button
                onClick={handleEndJam}
                className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 text-white transition-colors"
              >
                Back to Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jam Controls info modal */}
      {isInfoOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog" aria-modal="true"
          onClick={() => setIsInfoOpen(false)}
        >
          <div className="bg-[#1e1e2e] rounded-2xl border border-gray-700/50 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#cdd6f4]">Jam Controls</h2>
              <button
                onClick={() => setIsInfoOpen(false)}
                className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-[#cdd6f4] transition-colors"
                aria-label="Close info"
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
            <ul className="p-5 space-y-3">
              {JAM_CONTROLS_INFO.map(item => (
                <li key={item.name} className="text-sm">
                  <span className="font-semibold text-[#89b4fa]">{item.name}:</span>{' '}
                  <span className="text-gray-300">{item.description}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default JamMode;
