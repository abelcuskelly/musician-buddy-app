
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
  isStreaming?: boolean;
}
