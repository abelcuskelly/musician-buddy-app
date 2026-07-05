import { Message, SavedItemType } from '../types.ts';

// --- Explicit artifact extraction (primary mechanism) ---
// The system prompt instructs the model to wrap finished deliverables in
// HTML-comment markers, which react-markdown renders invisibly:
//   <!--artifact:lesson-plan title="Week 1 Chords"--> ...plan... <!--/artifact-->
// Extracting these gives us the exact file to save/download/share, without
// the conversational text around it.

export interface MessageArtifact {
  type: SavedItemType;
  title: string;
  content: string;
}

const ARTIFACT_PATTERN = /<!--\s*artifact:(lesson-plan|song)\s+title="([^"\n]*)"\s*-->\s*([\s\S]*?)\s*<!--\s*\/artifact\s*-->/g;

/** Extracts explicitly marked artifacts from a model message. */
export const extractArtifacts = (content: string): MessageArtifact[] => {
  const artifacts: MessageArtifact[] = [];
  for (const match of content.matchAll(ARTIFACT_PATTERN)) {
    const body = match[3].trim();
    if (!body) continue;
    artifacts.push({
      type: match[1] as SavedItemType,
      title: (match[2].trim() || extractTitle(body, match[1] as SavedItemType)).slice(0, 80),
      content: body,
    });
  }
  return artifacts;
};

/**
 * Removes artifact markers for display (react-markdown renders raw HTML
 * comments as literal text). Also hides a partially streamed marker at the
 * end of the content so nothing flashes while a response is streaming in.
 */
export const stripArtifactMarkers = (content: string): string =>
  content
    .replace(/<!--\s*artifact:(?:lesson-plan|song)\s+title="[^"\n]*"\s*-->\n?/g, '')
    .replace(/<!--\s*\/artifact\s*-->\n?/g, '')
    .replace(/<!--[^>]*$/, '');

// --- Heuristic fallback (for messages without markers) ---

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

  // Lesson-plan structure is checked FIRST: plans frequently contain chord
  // tokens like [G] [Em] in their exercises, and must not be labeled "song".
  if (content.length >= MIN_LESSON_PLAN_LENGTH) {
    const scheduleHeadings = content.match(SCHEDULE_HEADING)?.length ?? 0;
    if (scheduleHeadings >= 2 || PLAN_TITLE_HEADING.test(content)) {
      return 'lesson-plan';
    }
  }

  const sectionTags = content.match(SONG_SECTION_TAG)?.length ?? 0;
  const chordTokens = content.match(CHORD_TOKEN)?.length ?? 0;
  if (sectionTags >= 2 || chordTokens >= 4 || (sectionTags >= 1 && chordTokens >= 2)) {
    return 'song';
  }

  return null;
};

/**
 * Returns the saveable artifacts for a message: generated audio first (its
 * lyric sheet is the text content), then explicitly marked artifacts, then
 * the whole-message heuristic as a fallback for unmarked content.
 */
export const getMessageArtifacts = (message: Message): MessageArtifact[] => {
  if (message.audioData) {
    const sheet = message.lyricsSheet || message.content;
    return [{ type: 'audio', title: extractTitle(sheet, 'audio'), content: sheet }];
  }
  const marked = extractArtifacts(message.content);
  if (marked.length > 0) return marked;

  const fallbackType = classifyMessage(message);
  if (fallbackType) {
    return [{ type: fallbackType, title: extractTitle(message.content, fallbackType), content: message.content }];
  }
  return [];
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
