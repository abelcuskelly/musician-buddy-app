import React, { useState } from 'react';
import { Message as MessageType } from '../types.js';
import { useAuth } from '../context/AuthContext.tsx';
import { classifyMessage, extractTitle, downloadMarkdown } from '../lib/content.ts';
import { saveMessageToLibrary } from '../services/library.ts';
import { SharePayload } from '../lib/share.ts';
import { speak, stopSpeaking, prepareTextForSpeech } from '../lib/voice.ts';
import MarkdownContent from './MarkdownContent.tsx';
import ShareButton from './ShareButton.tsx';
import BotIcon from './icons/BotIcon.js';
import UserIcon from './icons/UserIcon.js';
import DownloadIcon from './icons/DownloadIcon.tsx';
import BookmarkIcon from './icons/BookmarkIcon.tsx';
import CheckIcon from './icons/CheckIcon.tsx';
import SpeakerIcon from './icons/SpeakerIcon.tsx';
import StopIcon from './icons/StopIcon.tsx';

interface MessageProps {
  message: MessageType;
  onRequireSignIn: () => void;
}

const SAVE_LABELS: Record<string, string> = {
  'lesson-plan': 'Save Lesson Plan',
  song: 'Save Song',
  audio: 'Save Audio',
};

const Message: React.FC<MessageProps> = ({ message, onRequireSignIn }) => {
  const isModel = message.role === 'model';
  const { user } = useAuth();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [speechState, setSpeechState] = useState<'idle' | 'loading' | 'speaking'>('idle');

  const savedType = isModel && !message.isStreaming ? classifyMessage(message) : null;
  const canSpeak = isModel && !message.isStreaming && message.content.trim().length > 0;

  const handleSpeakClick = async () => {
    if (speechState !== 'idle') {
      stopSpeaking();
      setSpeechState('idle');
      return;
    }
    setSpeechState('loading');
    try {
      setSpeechState('speaking');
      await speak(prepareTextForSpeech(message.content));
    } catch (e) {
      console.error('Read-aloud failed:', e);
    } finally {
      setSpeechState('idle');
    }
  };
  // For generated audio, the lyric & chord sheet is the canonical text content.
  const sheetContent = savedType === 'audio' ? (message.lyricsSheet || message.content) : message.content;
  const title = savedType ? extractTitle(sheetContent, savedType) : '';

  const handleDownloadSheet = () => {
    downloadMarkdown(title, sheetContent);
  };

  const handleSave = async () => {
    if (!user) {
      onRequireSignIn();
      return;
    }
    if (saveState === 'saving' || saveState === 'saved') return;
    setSaveState('saving');
    try {
      await saveMessageToLibrary(user.uid, message);
      setSaveState('saved');
    } catch (e) {
      console.error('Failed to save to profile:', e);
      setSaveState('error');
    }
  };

  const getSharePayload = (): SharePayload => ({
    type: savedType ?? 'song',
    title,
    // Sharing generated audio always includes the lyric & chord sheet.
    content: sheetContent,
    ...(message.audioData ? { audioData: message.audioData } : {}),
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
            <MarkdownContent content={message.content} />

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
                  <button
                    onClick={handleDownloadSheet}
                    className="text-xs text-[#89b4fa] hover:text-[#b4befe] transition-colors flex items-center gap-1 font-medium"
                    aria-label="Download lyric and chord sheet"
                  >
                    <DownloadIcon className="w-3.5 h-3.5" />
                    Download Sheet
                  </button>
                </div>
                <MarkdownContent content={message.lyricsSheet} />
              </div>
            )}

            {(savedType || canSpeak) && (
              <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-2 flex-wrap">
                {canSpeak && (
                  <button
                    onClick={handleSpeakClick}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      speechState !== 'idle'
                        ? 'bg-[#a6e3a1]/15 text-[#a6e3a1]'
                        : 'bg-[#313244] hover:bg-[#45475a] text-[#f9e2af]'
                    }`}
                    aria-label={speechState === 'idle' ? 'Read this message aloud' : 'Stop reading aloud'}
                  >
                    {speechState === 'idle' ? (
                      <>
                        <SpeakerIcon className="w-3.5 h-3.5" />
                        Read Aloud
                      </>
                    ) : (
                      <>
                        <StopIcon className="w-3.5 h-3.5" />
                        {speechState === 'loading' ? 'Loading...' : 'Stop'}
                      </>
                    )}
                  </button>
                )}
                {savedType && (
                <>
                <button
                  onClick={handleDownloadSheet}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#313244] hover:bg-[#45475a] text-[#89b4fa] text-xs font-medium transition-colors"
                  aria-label="Download as Markdown"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
                  {savedType === 'audio' ? 'Download Sheet' : 'Download'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saveState === 'saving' || saveState === 'saved'}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    saveState === 'saved'
                      ? 'bg-[#a6e3a1]/15 text-[#a6e3a1] cursor-default'
                      : 'bg-[#313244] hover:bg-[#45475a] text-[#cba6f7]'
                  } disabled:opacity-80`}
                  aria-label="Save to profile"
                >
                  {saveState === 'saved' ? (
                    <>
                      <CheckIcon className="w-3.5 h-3.5" />
                      Saved to Profile
                    </>
                  ) : (
                    <>
                      <BookmarkIcon className="w-3.5 h-3.5" filled={false} />
                      {saveState === 'saving' ? 'Saving...' : SAVE_LABELS[savedType]}
                    </>
                  )}
                </button>
                <ShareButton getPayload={getSharePayload} />
                {saveState === 'error' && (
                  <span className="text-xs text-red-400">Couldn't save. Please try again.</span>
                )}
                </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Message;
