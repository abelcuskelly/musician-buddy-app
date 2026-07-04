import React, { useState, useEffect } from 'react';
import { ShareRecord, fetchShare } from '../lib/share.ts';
import { downloadMarkdown } from '../lib/content.ts';
import MarkdownContent from './MarkdownContent.tsx';
import DownloadIcon from './icons/DownloadIcon.tsx';

const TYPE_LABELS: Record<string, string> = {
  'lesson-plan': 'Lesson Plan',
  song: 'Song',
  audio: 'Song / Audio Clip',
};

interface SharePageProps {
  shareId: string;
}

const SharePage: React.FC<SharePageProps> = ({ shareId }) => {
  const [share, setShare] = useState<ShareRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchShare(shareId)
      .then(setShare)
      .catch((e: any) => setError(e.message || 'Failed to load shared content.'));
  }, [shareId]);

  const audioSrc = `/api/share/${encodeURIComponent(shareId)}/audio`;

  return (
    <div className="min-h-screen bg-[#11111b] flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-3xl">
        <a href="/" className="flex items-center gap-3 mb-8 group w-fit">
          <img src="/jam-buddy-logo.png" alt="Jam Buddy logo" className="w-10 h-10 rounded-lg" />
          <span className="text-xl font-bold text-[#cdd6f4] group-hover:text-white transition-colors">Jam Buddy</span>
        </a>

        {error ? (
          <div className="bg-[#181825] border border-gray-700/50 rounded-2xl p-10 text-center">
            <h1 className="text-2xl font-bold text-[#cdd6f4] mb-2">Nothing to see here</h1>
            <p className="text-gray-400">{error}</p>
            <a href="/" className="inline-block mt-6 px-5 py-2.5 rounded-lg bg-gradient-to-br from-[#89b4fa] to-[#b4befe] text-gray-900 font-semibold hover:opacity-90 transition-opacity">
              Make your own music
            </a>
          </div>
        ) : !share ? (
          <div className="bg-[#181825] border border-gray-700/50 rounded-2xl p-10 text-center text-gray-400">
            Loading shared content...
          </div>
        ) : (
          <div className="bg-[#181825] border border-gray-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">
            <div className="p-6 border-b border-gray-700/50 bg-[#1e1e2e]/50">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#89b4fa]/15 text-[#89b4fa] uppercase tracking-wider">
                    {TYPE_LABELS[share.type] ?? 'Shared Content'}
                  </span>
                  <h1 className="text-2xl font-bold text-[#cdd6f4] mt-2">{share.title}</h1>
                  <p className="text-xs text-gray-500 mt-1">
                    Shared {new Date(share.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} via Jam Buddy
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {share.hasAudio && (
                    <a
                      href={audioSrc}
                      download={`${share.title.replace(/[^a-zA-Z0-9]+/g, '-')}.mp3`}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#313244] hover:bg-[#45475a] text-[#89b4fa] text-sm font-medium transition-colors"
                    >
                      <DownloadIcon className="w-4 h-4" />
                      MP3
                    </a>
                  )}
                  <button
                    onClick={() => downloadMarkdown(share.title, share.content)}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#313244] hover:bg-[#45475a] text-[#89b4fa] text-sm font-medium transition-colors"
                  >
                    <DownloadIcon className="w-4 h-4" />
                    {share.type === 'lesson-plan' ? 'Lesson Plan' : 'Sheet'}
                  </button>
                </div>
              </div>

              {share.hasAudio && (
                <audio controls className="w-full h-11 mt-5">
                  <source src={audioSrc} type="audio/mp3" />
                  Your browser does not support the audio element.
                </audio>
              )}
            </div>

            <div className="p-6 text-[#cdd6f4]">
              <MarkdownContent content={share.content} />
            </div>
          </div>
        )}

        <p className="text-center text-gray-500 text-sm mt-8">
          Created with <a href="/" className="text-[#89b4fa] hover:underline">Jam Buddy</a> — your AI jam partner for lessons, songwriting, and more.
        </p>
      </div>
    </div>
  );
};

export default SharePage;
