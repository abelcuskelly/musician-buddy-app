import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message as MessageType } from '../types.js';
import BotIcon from './icons/BotIcon.js';
import UserIcon from './icons/UserIcon.js';

interface MessageProps {
  message: MessageType;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const isModel = message.role === 'model';

  return (
    <div className={`flex items-start gap-4 ${isModel ? '' : 'flex-row-reverse'}`}>
      <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${isModel ? 'bg-[#89b4fa]' : 'bg-[#a6e3a1]'}`}>
        {isModel ? <BotIcon className="w-6 h-6 text-gray-900" /> : <UserIcon className="w-6 h-6 text-gray-900" />}
      </div>
      <div className={`max-w-[80%] p-4 rounded-2xl ${isModel ? 'bg-[#1e1e2e] rounded-tl-none' : 'bg-[#313244] rounded-tr-none'}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
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
      </div>
    </div>
  );
};

export default Message;
