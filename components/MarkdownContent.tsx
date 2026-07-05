import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownStyles = {
  h1: 'text-2xl font-bold my-4 text-[#fab387]',
  h2: 'text-xl font-bold my-3 text-[#fab387]',
  h3: 'text-lg font-bold my-2 text-[#fab387]',
  p: 'mb-4 leading-relaxed',
  ol: 'list-decimal list-inside my-4 pl-4 space-y-2',
  ul: 'list-disc list-inside my-4 pl-4 space-y-2',
  li: 'mb-2',
  inlineCode: 'bg-[#313244] text-[#f5c2e7] px-1.5 py-0.5 rounded-md font-mono text-sm',
  // Tabs/chord charts need strict fixed-width columns: monospace, no line
  // wrapping, and horizontal scroll on small screens so alignment never breaks.
  pre: 'bg-[#313244] p-3 rounded-lg overflow-x-auto my-4 font-mono text-xs sm:text-sm leading-relaxed',
  blockCode: 'font-mono whitespace-pre',
  strong: 'font-bold text-[#f9e2af]',
  em: 'italic text-[#cba6f7]',
  a: 'text-[#89b4fa] hover:underline',
};

const MarkdownContent: React.FC<{ content: string }> = ({ content }) => (
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
      // react-markdown v9 has no `inline` prop: block code always sits inside
      // a <pre>, so the code component only detects which styling to apply.
      code: ({node, className, children, ...props}: any) => {
        const isBlock = /language-/.test(className ?? '') || /\n/.test(String(children));
        return (
          <code className={isBlock ? markdownStyles.blockCode : markdownStyles.inlineCode} {...props}>
            {children}
          </code>
        );
      },
      pre: ({node, ...props}) => <pre className={markdownStyles.pre} {...props} />,
      strong: ({node, ...props}) => <strong className={markdownStyles.strong} {...props} />,
      em: ({node, ...props}) => <em className={markdownStyles.em} {...props} />,
      a: ({node, ...props}) => <a className={markdownStyles.a} target="_blank" rel="noopener noreferrer" {...props} />,
    }}
  >
    {content}
  </ReactMarkdown>
);

export default MarkdownContent;
