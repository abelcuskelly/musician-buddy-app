import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message as MessageType } from '../types.js';
import { useAuth } from '../context/AuthContext.tsx';
import { classifyMessage, extractTitle, downloadMarkdown } from '../lib/content.ts';
import { saveMessageToLibrary } from '../services/library.ts';
import BotIcon from './icons/BotIcon.js';
import UserIcon from './icons/UserIcon.js';
import DownloadIcon from './icons/DownloadIcon.tsx';
import BookmarkIcon from './icons/BookmarkIcon.tsx';
import CheckIcon from './icons/CheckIcon.tsx';

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

  const savedType = isModel && !message.isStreaming ? classifyMessage(message) : null;

  const handleDownload = () => {
    const type = savedType ?? 'song';
    downloadMarkdown(extractTitle(message.content, type), message.content);
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

  const markdownStyles = {
    h1: 'text-2xl font-bold my-4 text-[#fab387]',
    h2: 'text-xl font-bold my-3 text-[#fab387]',
    h3: 'text-lg font-bold my-2 text-[#fab387]',
    p: 'mb-4 leading-relaxed',
    ol: 'list-decimal list-inside my-4 pl-4 space-y-2',
    ul: 'list-disc list-inside my-4 pl-4 space-y-2',
    li: 'mb-2',
    code: 'bg-[#313244] text-[#f5c2e7] px-2 py-1 rounded-md font-mono text-sm',
    pre: 'bg-[#313244] p-4 rounded-lg overflow-x-auto my-4',
    strong: 'font-bold text-[#f9e2af]',
    em: 'italic text-[#cba6f7]',
    a: 'text-[#89b4fa] hover:underline',
  };

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
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({node, ...props}) => <h1 className={markdownStyles.h1} {...props} />,
                h2: ({node, ...props}) => <h2 className={markdownStyles.h2} {...props} />,
                h3: ({node, ...props}) => <h3 className={markdownStyles.h3} {...props} />,
                p: ({node, ...props}) => <p className={markdownStyles.p} {...props} />,
                ol: ({node, ...props}) => <ol className={markdownStyles.ol} {...props} />,
                ul: ({node, ...props}) => <ul className={markdownStyles.ul} {...props} />,
                li: ({node, ...props}) => <li className={markdownStyles.li} {...props} />,
                code: ({node, inline, ...props}: any) => inline ? <code className={markdownStyles.code} {...props} /> : <div className={markdownStyles.pre}><code {...props} /></div>,
                pre: ({node, ...props}) => <pre className={markdownStyles.pre} {...props} />,
                strong: ({node, ...props}) => <strong className={markdownStyles.strong} {...props} />,
                em: ({node, ...props}) => <em className={markdownStyles.em} {...props} />,
                a: ({node, ...props}) => <a className={markdownStyles.a} target="_blank" rel="noopener noreferrer" {...props} />,
              }}
            >
              {message.content}
            </ReactMarkdown>

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
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download MP3
                  </a>
                </div>
                <audio controls className="w-full h-10">
                  <source src={`data:audio/mp3;base64,${message.audioData}`} type="audio/mp3" />
                  Your browser does not support the audio element.
                </audio>
              </div>
            )}

            {savedType && (
              <div className="mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-2 flex-wrap">
                {savedType !== 'audio' && (
                  <button
                    onClick={handleDownload}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#313244] hover:bg-[#45475a] text-[#89b4fa] text-xs font-medium transition-colors"
                    aria-label="Download as Markdown"
                  >
                    <DownloadIcon className="w-3.5 h-3.5" />
                    Download
                  </button>
                )}
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
                {saveState === 'error' && (
                  <span className="text-xs text-red-400">Couldn't save. Please try again.</span>
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
