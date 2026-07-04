import { Message, SavedItemType } from '../types.ts';

// Structural signals that a message contains an actual artifact (a written
// song sheet or a scheduled lesson plan), not just a conversational mention
// of one. Keyword matching alone shows save/download/share buttons on plain
// chat replies, so classification requires document structure:

// Song section tags on their own, e.g. "[Verse 1]", "[Chorus]", "[Bridge]"
const SONG_SECTION_TAG = /\[(verse|chorus|bridge|intro|outro|pre-chorus|hook|refrain|solo|drop)[^\]\n]{0,12}\]/gi;
// Bracketed chord notation, e.g. "[G]", "[Em7]", "[D/F#]", "[Bbmaj7]"
const CHORD_TOKEN = /\[[A-G][#b♯♭]?(?:maj|min|m|M|dim|aug|sus|add)?\d{0,2}(?:\/[A-G][#b♯♭]?)?\]/g;
// Schedule headings at the start of a line, e.g. "### 🎸 Day 1:", "**Week 2 -", "Monday:"
const SCHEDULE_HEADING = /^.{0,15}\b(?:day\s*\d+|week\s*\d+|session\s*\d+|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b\s*[:\-–—]/gim;
// A title heading that names the document a plan, e.g. "## Your Weekly Lesson Plan"
const PLAN_TITLE_HEADING = /^#{1,4}\s+[^\n]*(lesson plan|practice plan|practice routine|practice schedule)/im;

// Lesson-plan artifacts are substantial; short replies are conversation.
// (Song notation is unambiguous, so no length minimum is applied there.)
const MIN_LESSON_PLAN_LENGTH = 250;

/**
 * Classifies a model message so the right save/download actions can be shown.
 * Returns null for conversational messages that aren't worth saving — buttons
 * appear only when the message contains actual notated/structured content.
 */
export const classifyMessage = (message: Message): SavedItemType | null => {
  if (message.audioData) return 'audio';
  const content = message.content;

  const sectionTags = content.match(SONG_SECTION_TAG)?.length ?? 0;
  const chordTokens = content.match(CHORD_TOKEN)?.length ?? 0;
  if (sectionTags >= 2 || chordTokens >= 4 || (sectionTags >= 1 && chordTokens >= 2)) {
    return 'song';
  }

  if (content.length >= MIN_LESSON_PLAN_LENGTH) {
    const scheduleHeadings = content.match(SCHEDULE_HEADING)?.length ?? 0;
    if (scheduleHeadings >= 2 || PLAN_TITLE_HEADING.test(content)) {
      return 'lesson-plan';
    }
  }

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
