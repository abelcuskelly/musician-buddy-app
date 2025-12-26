
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Message as MessageType } from '../types.ts';
import BotIcon from './icons/BotIcon.tsx';
import UserIcon from './icons/UserIcon.tsx';

interface MessageProps {
  message: MessageType;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const isModel = message.role === 'model';

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
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-0"></span>
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-150"></span>
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-pulse delay-300"></span>
          </div>
        ) : (
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
              code: ({node, inline, ...props}) => inline ? <code className={markdownStyles.code} {...props} /> : <div className={markdownStyles.pre}><code {...props} /></div>,
              pre: ({node, ...props}) => <pre className={markdownStyles.pre} {...props} />,
              strong: ({node, ...props}) => <strong className={markdownStyles.strong} {...props} />,
              em: ({node, ...props}) => <em className={markdownStyles.em} {...props} />,
              a: ({node, ...props}) => <a className={markdownStyles.a} target="_blank" rel="noopener noreferrer" {...props} />,
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
      </div>
    </div>
  );
};

export default Message;
