import React, { useState, useEffect, useMemo } from 'react';
import CloseIcon from './icons/CloseIcon.tsx';

interface JamSheetProps {
  sheet: string; // markdown-ish chord/lyric sheet
  bpm: number;
  isPlaying: boolean;
  onClose: () => void;
}

const CHORD_REGEX = /\[[A-G][#b♯♭]?(?:maj|min|m|M|dim|aug|sus|add)?\d{0,2}(?:\/[A-G][#b♯♭]?)?\]/g;

type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'chord'; value: string; index: number };

interface SheetLine {
  kind: 'heading' | 'section' | 'line';
  segments: Segment[];
  raw: string;
}

/** Splits the sheet into lines/segments, numbering chords in play order. */
const parseSheet = (sheet: string): { lines: SheetLine[]; chordCount: number } => {
  const lines: SheetLine[] = [];
  let chordIndex = 0;

  for (const raw of sheet.split('\n')) {
    if (/^#{1,4}\s/.test(raw)) {
      lines.push({ kind: 'heading', raw: raw.replace(/^#+\s*/, ''), segments: [] });
      continue;
    }
    if (/^\s*\[[^\]]{3,}\]\s*$/.test(raw) && !CHORD_REGEX.test(raw)) {
      lines.push({ kind: 'section', raw: raw.trim(), segments: [] });
      continue;
    }
    CHORD_REGEX.lastIndex = 0;
    const segments: Segment[] = [];
    let cursor = 0;
    for (const match of raw.matchAll(CHORD_REGEX)) {
      if (match.index! > cursor) segments.push({ kind: 'text', value: raw.slice(cursor, match.index) });
      segments.push({ kind: 'chord', value: match[0].slice(1, -1), index: chordIndex++ });
      cursor = match.index! + match[0].length;
    }
    if (cursor < raw.length) segments.push({ kind: 'text', value: raw.slice(cursor) });
    lines.push({ kind: 'line', raw, segments });
  }

  return { lines, chordCount: chordIndex };
};

/**
 * Play-along chord sheet: while music plays, the highlight steps through the
 * chords in time — one chord per bar (4 beats) at the current BPM.
 */
const JamSheet: React.FC<JamSheetProps> = ({ sheet, bpm, isPlaying, onClose }) => {
  const { lines, chordCount } = useMemo(() => parseSheet(sheet), [sheet]);
  const [activeChord, setActiveChord] = useState(0);

  useEffect(() => {
    if (!isPlaying || chordCount === 0) return;
    const barMs = (60 / Math.max(bpm, 40)) * 4 * 1000;
    const interval = setInterval(() => {
      setActiveChord(prev => (prev + 1) % chordCount);
    }, barMs);
    return () => clearInterval(interval);
  }, [isPlaying, bpm, chordCount]);

  return (
    <div className="mx-4 mb-2 bg-[#181825] border border-gray-700/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700/40 bg-[#11111b]/60">
        <span className="text-xs font-bold text-[#f9e2af] uppercase tracking-widest flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full bg-[#f9e2af] ${isPlaying ? 'animate-pulse' : 'opacity-40'}`}></span>
          Play Along{chordCount > 0 ? ` — chord ${(activeChord % Math.max(chordCount, 1)) + 1}/${chordCount}` : ''}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-white/10 text-gray-400 hover:text-[#cdd6f4] transition-colors"
          aria-label="Hide play-along sheet"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="px-4 py-3 max-h-[30vh] overflow-y-auto font-mono text-sm leading-7">
        {lines.map((line, i) => {
          if (line.kind === 'heading') {
            return <p key={i} className="font-sans font-bold text-[#fab387] text-base mt-1 mb-1">{line.raw}</p>;
          }
          if (line.kind === 'section') {
            return <p key={i} className="font-sans font-semibold text-[#89b4fa] mt-2">{line.raw}</p>;
          }
          if (line.segments.length === 0) {
            return <p key={i} className="whitespace-pre-wrap text-gray-300 min-h-[0.75rem]">{line.raw}</p>;
          }
          return (
            <p key={i} className="whitespace-pre-wrap text-gray-300">
              {line.segments.map((seg, j) =>
                seg.kind === 'chord' ? (
                  <span
                    key={j}
                    className={`inline-block px-1 rounded font-bold transition-colors duration-150 ${
                      seg.index === activeChord && isPlaying
                        ? 'bg-[#f9e2af] text-gray-900'
                        : 'text-[#f9e2af]'
                    }`}
                  >
                    {seg.value}
                  </span>
                ) : (
                  <span key={j}>{seg.value}</span>
                )
              )}
            </p>
          );
        })}
      </div>
    </div>
  );
};

export default JamSheet;
