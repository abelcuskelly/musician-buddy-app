import React, { useState } from 'react';
import { SharePayload, createShare, copyToClipboard } from '../lib/share.ts';
import ShareIcon from './icons/ShareIcon.tsx';
import CheckIcon from './icons/CheckIcon.tsx';

interface ShareButtonProps {
  /** Called when the user clicks Share; may fetch audio etc. before returning the payload. */
  getPayload: () => Promise<SharePayload> | SharePayload;
  className?: string;
  iconClassName?: string;
  /** Compact mode renders just the icon (for tight toolbars like the library list). */
  compact?: boolean;
}

type ShareState = 'idle' | 'sharing' | 'copied' | 'error';

const ShareButton: React.FC<ShareButtonProps> = ({ getPayload, className, iconClassName, compact }) => {
  const [state, setState] = useState<ShareState>('idle');
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const handleShare = async () => {
    if (state === 'sharing') return;
    setState('sharing');
    try {
      // Reuse the link if this exact item was already shared in this session.
      const url = shareUrl ?? await createShare(await getPayload());
      setShareUrl(url);
      try {
        await copyToClipboard(url);
        setState('copied');
      } catch {
        // Clipboard can be blocked (e.g. non-user-gesture); show the URL instead.
        window.prompt('Copy your share link:', url);
        setState('idle');
        return;
      }
      setTimeout(() => setState('idle'), 2500);
    } catch (e) {
      console.error('Failed to share:', e);
      setState('error');
      setTimeout(() => setState('idle'), 3000);
    }
  };

  const icon = state === 'copied'
    ? <CheckIcon className={iconClassName ?? 'w-3.5 h-3.5'} />
    : <ShareIcon className={iconClassName ?? 'w-3.5 h-3.5'} />;

  if (compact) {
    return (
      <button
        onClick={handleShare}
        disabled={state === 'sharing'}
        className={className ?? 'p-2 rounded-full hover:bg-white/10 text-[#94e2d5] transition-colors disabled:opacity-50'}
        aria-label="Share link"
        title={state === 'copied' ? 'Link copied!' : state === 'error' ? 'Sharing failed' : 'Share'}
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      onClick={handleShare}
      disabled={state === 'sharing'}
      className={className ?? `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        state === 'copied' ? 'bg-[#a6e3a1]/15 text-[#a6e3a1]' : 'bg-[#313244] hover:bg-[#45475a] text-[#94e2d5]'
      } disabled:opacity-70`}
      aria-label="Share link"
    >
      {icon}
      {state === 'sharing' ? 'Creating link...' : state === 'copied' ? 'Link Copied!' : state === 'error' ? 'Share Failed' : 'Share'}
    </button>
  );
};

export default ShareButton;
