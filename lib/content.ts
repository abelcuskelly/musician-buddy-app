import { Message, SavedItemType } from '../types.ts';

const LESSON_PLAN_PATTERN = /lesson plan|practice plan|practice routine|practice schedule|weekly plan|week(ly)? (lesson|practice)|day \d+\s*[:-]/i;
const SONG_PATTERN = /\[?(verse|chorus|bridge|intro|outro|pre-chorus|hook)\b\s*\d*\]?[:\]]|lyrics|chord progression|strumming pattern|melody|\bbpm\b|key of [A-G]/i;

// Short conversational replies that merely mention "lesson plan" or "chorus"
// shouldn't get save buttons; real generated content is much longer.
const MIN_SAVEABLE_LENGTH = 250;

/**
 * Classifies a model message so the right save/download actions can be shown.
 * Returns null for conversational messages that aren't worth saving.
 */
export const classifyMessage = (message: Message): SavedItemType | null => {
  if (message.audioData) return 'audio';
  if (message.content.length < MIN_SAVEABLE_LENGTH) return null;
  if (LESSON_PLAN_PATTERN.test(message.content)) return 'lesson-plan';
  if (SONG_PATTERN.test(message.content)) return 'song';
  return null;
};

/** Derives a human-friendly title from message content (first heading or line). */
export const extractTitle = (content: string, type: SavedItemType): string => {
  const headingMatch = content.match(/^#{1,3}\s+(.+)$/m);
  let title = headingMatch?.[1] ?? content.split('\n').find(line => line.trim().length > 0) ?? '';
  title = title.replace(/[#*_`>]/g, '').trim();
  if (title.length > 60) {
    title = `${title.slice(0, 57).trimEnd()}...`;
  }
  if (!title) {
    const fallbacks: Record<SavedItemType, string> = {
      'lesson-plan': 'Lesson Plan',
      song: 'Song',
      audio: 'Audio Track',
    };
    title = fallbacks[type];
  }
  return title;
};

const slugify = (title: string): string =>
  title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'musician-buddy';

/** Triggers a browser download of text content as a Markdown file. */
export const downloadMarkdown = (title: string, content: string): void => {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${slugify(title)}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

/** Downloads audio from a remote URL (e.g. Firebase Storage) as an MP3 file. */
export const downloadAudioFromUrl = async (url: string, title: string): Promise<void> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `${slugify(title)}.mp3`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Fall back to opening the file directly if the blob download fails
    window.open(url, '_blank', 'noopener');
  }
};
