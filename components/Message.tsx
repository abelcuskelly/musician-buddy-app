import React, { useState, useMemo } from 'react';
import { Message as MessageType } from '../types.js';
import { useAuth } from '../context/AuthContext.tsx';
import { getMessageArtifacts, stripArtifactMarkers, downloadMarkdown, MessageArtifact } from '../lib/content.ts';
import { saveArtifactToLibrary } from '../services/library.ts';
import { SharePayload } from '../lib/share.ts';
import MarkdownContent from './MarkdownContent.tsx';
import ShareButton from './ShareButton.tsx';
import BotIcon from './icons/BotIcon.js';
import UserIcon from './icons/UserIcon.js';
import DownloadIcon from './icons/DownloadIcon.tsx';
import BookmarkIcon from './icons/BookmarkIcon.tsx';
import CheckIcon from './icons/CheckIcon.tsx';

interface MessageProps {
  message: MessageType;
  onRequireSignIn: () => void;
}

// Every action button names what it acts on, so a lesson plan never shows
// song-related buttons and vice versa.
const TYPE_LABELS: Record<string, { save: string; download: string; share: string }> = {
  'lesson-plan': { save: 'Save Lesson Plan', download: 'Download Lesson Plan', share: 'Share Lesson Plan' },
  song: { save: 'Save Song Sheet', download: 'Download Song Sheet', share: 'Share Song Sheet' },
  audio: { save: 'Save Audio', download: 'Download Sheet', share: 'Share Audio' },
};

const Message: React.FC<MessageProps> = ({ message, onRequireSignIn }) => {
  const isModel = message.role === 'model';
  const { user } = useAuth();
  const [saveStates, setSaveStates] = useState<Record<number, 'idle' | 'saving' | 'saved' | 'error'>>({});

  // The saveable artifacts in this message — exact plan/sheet text, not the
  // whole chat reply. Audio messages carry their audioData alongside.
  const artifacts = useMemo<MessageArtifact[]>(
    () => (isModel && !message.isStreaming ? getMessageArtifacts(message) : []),
    [isModel, message]
  );

  const handleSave = async (artifact: MessageArtifact, index: number) => {
    if (!user) {
      onRequireSignIn();
      return;
    }
    const state = saveStates[index] ?? 'idle';
    if (state === 'saving' || state === 'saved') return;
    setSaveStates(prev => ({ ...prev, [index]: 'saving' }));
    try {
      await saveArtifactToLibrary(user.uid, {
        type: artifact.type,
        title: artifact.title,
        content: artifact.content,
        ...(artifact.type === 'audio' && message.audioData ? { audioData: message.audioData } : {}),
      });
      setSaveStates(prev => ({ ...prev, [index]: 'saved' }));
    } catch (e) {
      console.error('Failed to save to profile:', e);
      setSaveStates(prev => ({ ...prev, [index]: 'error' }));
    }
  };

  const getSharePayload = (artifact: MessageArtifact): SharePayload => ({
    type: artifact.type,
    title: artifact.title,
    // Sharing generated audio always includes the lyric & chord sheet.
    content: artifact.content,
    ...(artifact.type === 'audio' && message.audioData ? { audioData: message.audioData } : {}),
  });

  return (
    <div className={`flex items-start gap-4 ${isModel ? '' : 'flex-row-reverse'}`}>
      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isModel ? 'bg-[#89b4fa]' : 'bg-[#a6e3a1]'}`}>
        {isModel ? <BotIcon className="w-6 h-6 text-gray-900" /> : <UserIcon className="w-6 h-6 text-gray-900" />}
      </div>
      <div className={`max-w-[80%] p-4 rounded-2xl ${isModel ? 'bg-[#1e1e2e] rounded-tl-none' : 'bg-[#313244] rounded-tr-none'}`}>
        {message.isStreaming && message.content.length === 0 ? (
          <div className="flex items-center gap-2 py-2">
            <span className="text-sm text-gray-400 italic mr-2">Thinking</span>
            <span className="w-1.5 h-1.5 bg-[#89b4fa] rounded-full animate-bounce [animation-delay:-0.3s]"></span>
            <span className="w-1.5 h-1.5 bg-[#89b4fa] rounded-full animate-bounce [animation-delay:-0.15s]"></span>
            <span className="w-1.5 h-1.5 bg-[#89b4fa] rounded-full animate-bounce"></span>
          </div>
        ) : (
          <>
            <MarkdownContent content={isModel ? stripArtifactMarkers(message.content) : message.content} />

            {message.audioData && (
              <div className="mt-4 p-4 bg-[#181825] rounded-xl border border-gray-700 shadow-inner">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-[#cba6f7] uppercase tracking-widest flex items-center gap-2">
                    <span className="w-2 h-2 bg-[#cba6f7] rounded-full animate-ping"></span>
                    Lyria 3 High-Fidelity Audio
                  </span>
                  <a 
                    href={`data:audio/mp3;base64,${message.audioData}`} 
                    download="musician-buddy-composition.mp3"
                    className="text-xs text-[#89b4fa] hover:text-[#b4befe] transition-colors flex items-center gap-1 font-medium"
                  >
                    <DownloadIcon className="w-3.5 h-3.5" />
                    Download MP3
                  </a>
                </div>
                <audio controls className="w-full h-10">
                  <source src={`data:audio/mp3;base64,${message.audioData}`} type="audio/mp3" />
                  Your browser does not support the audio element.
                </audio>
              </div>
            )}

            {message.audioData && message.lyricsSheet && (
              <div className="mt-4 p-4 bg-[#181825] rounded-xl border border-gray-700 shadow-inner">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-[#f9e2af] uppercase tracking-widest">
                    Lyrics &amp; Chord Sheet
                  </span>
                </div>
                <MarkdownContent content={message.lyricsSheet} />
              </div>
            )}

            {artifacts.map((artifact, index) => {
              const state = saveStates[index] ?? 'idle';
              return (
                <div key={index} className="mt-3 pt-3 border-t border-gray-700/50">
                  {artifacts.length > 1 && (
                    <p className="text-xs text-gray-500 mb-1.5 truncate">{artifact.title}</p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={() => downloadMarkdown(artifact.title, artifact.content)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#313244] hover:bg-[#45475a] text-[#89b4fa] text-xs font-medium transition-colors"
                      aria-label={`${TYPE_LABELS[artifact.type].download}: ${artifact.title}`}
                    >
                      <DownloadIcon className="w-3.5 h-3.5" />
                      {TYPE_LABELS[artifact.type].download}
                    </button>
                    <button
                      onClick={() => handleSave(artifact, index)}
                      disabled={state === 'saving' || state === 'saved'}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        state === 'saved'
                          ? 'bg-[#a6e3a1]/15 text-[#a6e3a1] cursor-default'
                          : 'bg-[#313244] hover:bg-[#45475a] text-[#cba6f7]'
                      } disabled:opacity-80`}
                      aria-label={`${TYPE_LABELS[artifact.type].save}: ${artifact.title}`}
                    >
                      {state === 'saved' ? (
                        <>
                          <CheckIcon className="w-3.5 h-3.5" />
                          Saved to Profile
                        </>
                      ) : (
                        <>
                          <BookmarkIcon className="w-3.5 h-3.5" filled={false} />
                          {state === 'saving' ? 'Saving...' : TYPE_LABELS[artifact.type].save}
                        </>
                      )}
                    </button>
                    <ShareButton getPayload={() => getSharePayload(artifact)} label={TYPE_LABELS[artifact.type].share} />
                    {state === 'error' && (
                      <span className="text-xs text-red-400">Couldn't save. Please try again.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
};

export default Message;
