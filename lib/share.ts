import { SavedItemType } from '../types.ts';

export interface SharePayload {
  type: SavedItemType;
  title: string;
  content: string;
  audioData?: string; // Base64 MP3, included when sharing generated audio
}

export interface ShareRecord {
  id: string;
  type: SavedItemType;
  title: string;
  content: string;
  hasAudio: boolean;
  createdAt: number;
}

/** Creates a public share on the server and returns the absolute share URL. */
export const createShare = async (payload: SharePayload): Promise<string> => {
  const response = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || 'Failed to create share link.');
  }
  const { path } = await response.json() as { id: string; path: string };
  return `${window.location.origin}${path}`;
};

/** Fetches a shared item by ID for the public share page. */
export const fetchShare = async (id: string): Promise<ShareRecord> => {
  const response = await fetch(`/api/share/${encodeURIComponent(id)}`);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message || 'Failed to load shared content.');
  }
  return await response.json() as ShareRecord;
};

/** Converts a Blob (e.g. fetched audio) to a raw base64 string. */
export const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

/** Copies text to the clipboard, with a fallback for older browsers. */
export const copyToClipboard = async (text: string): Promise<void> => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
};
