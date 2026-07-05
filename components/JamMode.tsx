import React, { useState, useEffect, useRef, useCallback } from 'react';
import { JamSession, JamPrompt, JamConfig, JAM_SCALES, JAM_INSTRUMENTS, JAM_STYLES, JAM_PROMPT_COLORS } from '../lib/jamSession.ts';
import { JamAudioPlayer } from '../lib/jamAudio.ts';
import { copyToClipboard } from '../lib/share.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { saveJamPreset, listJamPresets, deleteJamPreset, JamMixPreset } from '../services/jamPresets.ts';
import { listLibraryItems } from '../services/library.ts';
import { SavedItem } from '../types.ts';
import AuthModal from './AuthModal.tsx';
import JamSheet from './JamSheet.tsx';
import CloseIcon from './icons/CloseIcon.tsx';
import InfoIcon from './icons/InfoIcon.tsx';
import PlayIcon from './icons/PlayIcon.tsx';
import PauseIcon from './icons/PauseIcon.tsx';
import TrashIcon from './icons/TrashIcon.tsx';
import ShareIcon from './icons/ShareIcon.tsx';
import VolumeIcon from './icons/VolumeIcon.tsx';
import CheckIcon from './icons/CheckIcon.tsx';
import BookmarkIcon from './icons/BookmarkIcon.tsx';
import LibraryIcon from './icons/LibraryIcon.tsx';
import MusicNoteIcon from './icons/MusicNoteIcon.tsx';

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
};

const JAM_CONTROLS_INFO: { name: string; description: string }[] = [
  { name: 'Add a Prompt', description: 'Add a musical instrument, genre, mood, etc. as a slider — blend up to 10 to shape the jam. Use the Instruments and Music Styles pickers for ideas.' },
  { name: 'Volume (− / +)', description: 'Nudge how loud each instrument or style sits in the mix (fine control over its slider weight).' },
  { name: 'Density', description: 'Make the music smooth or punchy.' },
  { name: 'Brightness', description: 'Adjust the tone.' },
  { name: 'Chaos', description: 'Make the music random or repetitive.' },
  { name: 'BPM', description: 'Set the tempo (restarts the music).' },
  { name: 'Key', description: 'Set the key center (restarts the music).' },
  { name: 'Share', description: 'Shares a URL with the last minute of your jam.' },
];

let promptIdCounter = 0;
const makePrompt = (text: string, weight = 1.0, muted = false): JamPrompt => ({
  id: `jp-${++promptIdCounter}`,
  text,
  weight,
  muted,
  color: JAM_PROMPT_COLORS[promptIdCounter % JAM_PROMPT_COLORS.length],
});

const JamMode: React.FC<JamModeProps> = ({ onEndJam }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<JamStatus>('connecting');
  const [prompts, setPrompts] = useState<JamPrompt[]>(() => [
    makePrompt('Warm Acoustic Guitar', 1.2),
    makePrompt('Indie Pop', 1.0),
  ]);
  const [config, setConfig] = useState<JamConfig>(DEFAULT_CONFIG);
  const [newPromptText, setNewPromptText] = useState('');
  const [openPicker, setOpenPicker] = useState<'instruments' | 'styles' | null>(null);
  const [volume, setVolume] = useState(0.9);
  const [notice, setNotice] = useState<string | null>(null);
  const [endedReason, setEndedReason] = useState<string | null>(null);
  const [endedUpsell, setEndedUpsell] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const [isBpmOpen, setIsBpmOpen] = useState(false);
  const [pendingBpm, setPendingBpm] = useState(120);
  const [shareState, setShareState] = useState<'idle' | 'sharing' | 'copied'>('idle');
  const authSentRef = useRef(false);
  // Play-along sheet + saved mixes + song-seeded jams
  const [sheet, setSheet] = useState<string | null>(null);
  const [showSheet, setShowSheet] = useState(false);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [mixesOpen, setMixesOpen] = useState(false);
  const [presets, setPresets] = useState<JamMixPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const [songsOpen, setSongsOpen] = useState(false);
  const [songs, setSongs] = useState<SavedItem[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);
  const [seedingId, setSeedingId] = useState<string | null>(null);

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
      onEnded: (reason, upsell) => {
        setEndedReason(reason || 'The jam session ended.');
        setEndedUpsell(!!upsell);
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

  // Signed-in users get a longer session limit: prove it to the server with a
  // Firebase ID token as soon as both the session and the user are ready.
  useEffect(() => {
    if (!user || status === 'connecting' || status === 'ended' || authSentRef.current) return;
    authSentRef.current = true;
    user.getIdToken()
      .then(token => sessionRef.current?.sendAuth(token))
      .catch(() => { authSentRef.current = false; });
  }, [user, status]);

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
      // BPM/key changes apply immediately with a context reset. The client
      // intentionally does NOT flush its buffer: the ~2.5s of audio streamed
      // ahead keeps playing while the model recalibrates, so the transition
      // is a smooth handoff instead of a silent gap.
      sessionRef.current?.sendConfig(next, true);
    } else {
      queueSend(true);
    }
  };

  const nudgeWeight = (id: string, delta: number) => {
    const prompt = promptsRef.current.find(p => p.id === id);
    if (!prompt) return;
    updatePrompt(id, { weight: Math.min(Math.max(Math.round((prompt.weight + delta) * 100) / 100, 0.05), 2) });
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

  // --- Play-along sheet ---
  const handleSheetToggle = async () => {
    if (showSheet) {
      setShowSheet(false);
      return;
    }
    if (sheet) {
      setShowSheet(true);
      return;
    }
    setSheetLoading(true);
    try {
      const response = await fetch('/api/jam/sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompts: promptsRef.current.filter(p => !p.muted).map(p => ({ text: p.text, weight: p.weight })),
          bpm: configRef.current.bpm,
          scale: configRef.current.scale !== 'SCALE_UNSPECIFIED' ? configRef.current.scale : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Could not generate a chord sheet.');
      setSheet(data.sheet);
      setShowSheet(true);
    } catch (e: any) {
      setNotice(e.message || 'Could not generate a chord sheet.');
    } finally {
      setSheetLoading(false);
    }
  };

  // --- Saved mixes (presets) ---
  const handleOpenMixes = async () => {
    if (!user) {
      setNotice('Sign in to save and load your jam mixes.');
      setIsAuthOpen(true);
      return;
    }
    setMixesOpen(true);
    try {
      setPresets(await listJamPresets(user.uid));
    } catch (e: any) {
      setNotice(e.message || 'Could not load your saved mixes.');
    }
  };

  const handleSavePreset = async () => {
    if (!user || presetBusy) return;
    setPresetBusy(true);
    try {
      const preset = await saveJamPreset(user.uid, presetName || 'My Mix', promptsRef.current, configRef.current);
      setPresets(prev => [preset, ...prev]);
      setPresetName('');
    } catch (e: any) {
      setNotice(e.message || 'Could not save the mix.');
    } finally {
      setPresetBusy(false);
    }
  };

  const handleLoadPreset = (preset: JamMixPreset) => {
    setPrompts(preset.prompts.map(p => makePrompt(p.text, p.weight, p.muted)));
    updateConfig({ ...DEFAULT_CONFIG, ...preset.config }, true);
    queueSend(false);
    setMixesOpen(false);
  };

  const handleDeletePreset = async (preset: JamMixPreset) => {
    if (!user) return;
    try {
      await deleteJamPreset(user.uid, preset.id);
      setPresets(prev => prev.filter(p => p.id !== preset.id));
    } catch (e: any) {
      setNotice(e.message || 'Could not delete the mix.');
    }
  };

  // --- Jam from a saved song ---
  const handleOpenSongs = async () => {
    if (!user) {
      setNotice('Sign in to jam over songs from your library.');
      setIsAuthOpen(true);
      return;
    }
    setSongsOpen(true);
    setSongsLoading(true);
    try {
      const items = await listLibraryItems(user.uid);
      setSongs(items.filter(item => (item.type === 'song' || item.type === 'audio') && item.content.trim().length > 0));
    } catch (e: any) {
      setNotice(e.message || 'Could not load your songs.');
    } finally {
      setSongsLoading(false);
    }
  };

  const handleUseSong = async (item: SavedItem) => {
    if (seedingId) return;
    setSeedingId(item.id);
    try {
      const response = await fetch('/api/jam/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: item.title, content: item.content }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Could not derive jam settings from that song.');

      setPrompts(data.prompts.map((p: { text: string; weight: number }) => makePrompt(p.text, p.weight)));
      updateConfig(
        { bpm: data.bpm ?? configRef.current.bpm, scale: data.scale ?? 'SCALE_UNSPECIFIED' },
        true,
      );
      queueSend(false);
      setSheet(item.content);
      setShowSheet(true);
      setSongsOpen(false);
      setNotice(`Jamming over "${item.title}" — the play-along sheet is on screen.`);
    } catch (e: any) {
      setNotice(e.message || 'Could not use that song.');
    } finally {
      setSeedingId(null);
    }
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
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleOpenMixes}
              className="p-2 rounded-full hover:bg-white/10 text-[#cba6f7] transition-colors"
              aria-label="Saved mixes"
              title="Saved mixes"
            >
              <BookmarkIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleOpenSongs}
              className="p-2 rounded-full hover:bg-white/10 text-[#94e2d5] transition-colors"
              aria-label="Jam over one of your songs"
              title="Jam over one of your songs"
            >
              <LibraryIcon className="w-5 h-5" />
            </button>
            <button
              onClick={handleEndJam}
              className="px-4 py-2 rounded-lg bg-gradient-to-br from-[#f38ba8] to-[#eba0ac] text-gray-900 font-semibold hover:opacity-90 transition-opacity ml-1"
            >
              End Jam
            </button>
          </div>
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
                  <div className="flex items-center gap-0.5 mr-1.5 bg-[#11111b] rounded-full px-1 py-0.5 border border-gray-700/40">
                    <button
                      onClick={() => nudgeWeight(prompt.id, -0.25)}
                      disabled={prompt.muted || !!prompt.filteredReason || prompt.weight <= 0.05}
                      className="w-6 h-6 rounded-full hover:bg-white/10 text-gray-300 text-sm font-bold disabled:opacity-30 transition-colors"
                      aria-label={`Lower ${prompt.text} volume in the mix`}
                      title="Quieter in the mix"
                    >
                      −
                    </button>
                    <span className="text-xs text-gray-400 font-mono w-8 text-center" aria-hidden="true">
                      {Math.round((prompt.muted ? 0 : prompt.weight) * 50)}%
                    </span>
                    <button
                      onClick={() => nudgeWeight(prompt.id, 0.25)}
                      disabled={prompt.muted || !!prompt.filteredReason || prompt.weight >= 2}
                      className="w-6 h-6 rounded-full hover:bg-white/10 text-gray-300 text-sm font-bold disabled:opacity-30 transition-colors"
                      aria-label={`Raise ${prompt.text} volume in the mix`}
                      title="Louder in the mix"
                    >
                      +
                    </button>
                  </div>
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

          {/* Instrument / style pickers */}
          <div className="flex items-center gap-2">
            {([
              { id: 'instruments', label: '+ Instruments' },
              { id: 'styles', label: '+ Music Styles' },
            ] as const).map(picker => (
              <button
                key={picker.id}
                onClick={() => setOpenPicker(openPicker === picker.id ? null : picker.id)}
                className={`flex-1 px-3 py-2 rounded-xl text-sm font-medium transition-colors border ${
                  openPicker === picker.id
                    ? 'bg-[#89b4fa]/15 border-[#89b4fa]/60 text-[#89b4fa]'
                    : 'bg-[#181825] border-gray-700/50 text-[#cdd6f4] hover:border-[#89b4fa]/40'
                }`}
                aria-expanded={openPicker === picker.id}
              >
                {picker.label} {openPicker === picker.id ? '▴' : '▾'}
              </button>
            ))}
          </div>
          {openPicker && (
            <div className="bg-[#181825] border border-gray-700/50 rounded-xl p-3 max-h-[38vh] overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {(openPicker === 'instruments' ? JAM_INSTRUMENTS : JAM_STYLES).map(option => {
                  const alreadyAdded = prompts.some(p => p.text.toLowerCase() === option.toLowerCase());
                  return (
                    <button
                      key={option}
                      onClick={() => addPrompt(option)}
                      disabled={alreadyAdded || prompts.length >= 10}
                      className={`px-2.5 py-1.5 rounded-lg text-xs text-left transition-colors ${
                        alreadyAdded
                          ? 'bg-[#a6e3a1]/10 text-[#a6e3a1] cursor-default'
                          : 'bg-[#11111b] border border-gray-700/40 text-gray-300 hover:border-[#89b4fa]/50 disabled:opacity-40'
                      }`}
                    >
                      {alreadyAdded ? `✓ ${option}` : option}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </main>

        {/* Play-along sheet */}
        {showSheet && sheet && (
          <JamSheet
            sheet={sheet}
            bpm={config.bpm ?? 120}
            isPlaying={status === 'playing'}
            onClose={() => setShowSheet(false)}
          />
        )}

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
              onClick={handleSheetToggle}
              disabled={sheetLoading}
              className={`p-2.5 rounded-full transition-colors flex-shrink-0 ${
                showSheet ? 'bg-[#f9e2af]/20 text-[#f9e2af]' : 'bg-[#313244] hover:bg-[#45475a] text-[#f9e2af]'
              } ${sheetLoading ? 'animate-pulse' : ''}`}
              aria-label={showSheet ? 'Hide the play-along sheet' : 'Show a play-along chord sheet'}
              aria-pressed={showSheet}
              title={showSheet ? 'Hide play-along sheet' : 'Play-along sheet'}
            >
              <MusicNoteIcon className="w-4 h-4" />
            </button>

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
            <div className="flex justify-center gap-3 flex-wrap">
              {endedUpsell && !user && (
                <button
                  onClick={() => setIsAuthOpen(true)}
                  className="px-4 py-2 rounded-lg bg-gradient-to-br from-[#a6e3a1] to-[#94e2d5] text-gray-900 font-semibold hover:opacity-90 transition-opacity"
                >
                  Create Free Account
                </button>
              )}
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

      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />

      {/* Saved mixes modal */}
      {mixesOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog" aria-modal="true"
          onClick={() => setMixesOpen(false)}
        >
          <div className="bg-[#1e1e2e] rounded-2xl border border-gray-700/50 w-full max-w-md flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
              <h2 className="text-lg font-bold text-[#cdd6f4]">Saved Mixes</h2>
              <button onClick={() => setMixesOpen(false)} className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-[#cdd6f4] transition-colors" aria-label="Close saved mixes">
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4 overflow-y-auto">
              <form
                onSubmit={(e) => { e.preventDefault(); handleSavePreset(); }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  placeholder="Name this mix (e.g. Sunday Blues)"
                  className="flex-1 bg-[#313244] border-gray-600 rounded-lg p-2 text-sm focus:ring-2 focus:ring-[#89b4fa] focus:outline-none"
                  aria-label="Mix name"
                />
                <button
                  type="submit"
                  disabled={presetBusy}
                  className="px-3 py-2 rounded-lg bg-gradient-to-br from-[#89b4fa] to-[#b4befe] text-gray-900 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                >
                  {presetBusy ? 'Saving...' : 'Save Current'}
                </button>
              </form>
              {presets.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No saved mixes yet — dial in a sound you love, then save it here for future sessions.</p>
              ) : (
                presets.map(preset => (
                  <div key={preset.id} className="bg-[#181825] border border-gray-700/40 rounded-xl p-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[#cdd6f4] font-medium text-sm truncate">{preset.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {preset.prompts.map(p => p.text).join(' · ')}
                        {preset.config.bpm ? ` · ${preset.config.bpm} BPM` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => handleLoadPreset(preset)}
                        className="px-3 py-1.5 rounded-lg bg-[#313244] hover:bg-[#45475a] text-[#a6e3a1] text-xs font-semibold transition-colors"
                        aria-label={`Load mix ${preset.name}`}
                      >
                        Load
                      </button>
                      <button
                        onClick={() => handleDeletePreset(preset)}
                        className="p-2 rounded-full hover:bg-red-500/20 text-red-400 transition-colors"
                        aria-label={`Delete mix ${preset.name}`}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Song picker modal */}
      {songsOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="dialog" aria-modal="true"
          onClick={() => setSongsOpen(false)}
        >
          <div className="bg-[#1e1e2e] rounded-2xl border border-gray-700/50 w-full max-w-md flex flex-col max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-[#cdd6f4]">Jam Over Your Song</h2>
                <p className="text-xs text-gray-400 mt-0.5">Pick a saved song — the jam takes on its style, tempo, and key, with the chord sheet on screen.</p>
              </div>
              <button onClick={() => setSongsOpen(false)} className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-[#cdd6f4] transition-colors" aria-label="Close song picker">
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-2 overflow-y-auto">
              {songsLoading ? (
                <p className="text-sm text-gray-400 text-center py-4">Loading your songs...</p>
              ) : songs.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">No saved songs yet. Write or generate a song in chat and hit "Save Song" first!</p>
              ) : (
                songs.map(item => (
                  <button
                    key={item.id}
                    onClick={() => handleUseSong(item)}
                    disabled={!!seedingId}
                    className="w-full text-left bg-[#181825] border border-gray-700/40 hover:border-[#89b4fa]/50 rounded-xl p-3 transition-colors disabled:opacity-50"
                  >
                    <p className="text-[#cdd6f4] font-medium text-sm truncate">
                      {seedingId === item.id ? 'Setting up the jam...' : item.title}
                    </p>
                    <p className="text-xs text-gray-500">
                      {item.type === 'audio' ? 'Generated track' : 'Song sheet'}
                      {' · '}{new Date(item.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </button>
                ))
              )}
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
