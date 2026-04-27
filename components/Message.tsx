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
          <div className="mt-4 p-3 bg-[#181825] rounded-xl border border-gray-700">
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wider">Generated Audio</p>
            <audio controls className="w-full h-8">
              <source src={`data:audio/wav;base64,${message.audioData}`} type="audio/wav" />
              Your browser does not support the audio element.
            </audio>
            <a 
              href={`data:audio/wav;base64,${message.audioData}`} 
              download="musician-buddy-track.wav"
              className="mt-2 inline-block text-xs text-[#89b4fa] hover:underline"
            >
              Download Track
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default Message;
