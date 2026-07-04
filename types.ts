export type SkillLevel = 'Beginner' | 'Intermediate' | 'Advanced' | 'Expert';
export type FeedbackPreference = 'Direct and Technical' | 'Gentle and Encouraging';

export interface Profile {
  instrument: string;
  skillLevel: SkillLevel;
  musicalGoals: string;
  musicGenres: string;
  feedbackPreference: FeedbackPreference;
}

export type ChatRole = 'user' | 'model';

export interface Message {
  id: string;
  role: ChatRole;
  content: string;
  audioData?: string; // Base64 encoded audio
  lyricsSheet?: string; // Markdown lyric & chord sheet for generated audio
  isStreaming?: boolean;
}

export type SavedItemType = 'lesson-plan' | 'song' | 'audio';

export interface SavedItem {
  id: string;
  type: SavedItemType;
  title: string;
  content: string;
  audioUrl?: string; // Download URL for audio stored in Firebase Storage
  audioPath?: string; // Storage path, used for deletion
  createdAt: number; // epoch millis
}
