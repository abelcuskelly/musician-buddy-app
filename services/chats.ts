import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../lib/firebase.ts';
import { Message } from '../types.ts';

// Chat transcripts are stored without audio (base64 MP3s would blow the 1MB
// Firestore doc limit); generated audio lives in the library instead.
export interface StoredChatMessage {
  id: string;
  role: 'user' | 'model';
  content: string;
  lyricsSheet?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: StoredChatMessage[];
  messageCount: number;
  updatedAt: number;
}

const MAX_STORED_MESSAGES = 200;
const NOT_CONFIGURED_ERROR = 'Chat history is not configured yet. See AUTH_SETUP.md for Firebase setup instructions.';

const chatsCollection = (uid: string) => {
  if (!db) throw new Error(NOT_CONFIGURED_ERROR);
  return collection(db, 'users', uid, 'chats');
};

const toStoredMessages = (messages: Message[]): StoredChatMessage[] =>
  messages
    .filter(m => m.content && !m.isStreaming)
    .slice(-MAX_STORED_MESSAGES)
    .map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
      ...(m.lyricsSheet ? { lyricsSheet: m.lyricsSheet } : {}),
    }));

/** Saves (or updates) the current chat session in the user's history. */
export const saveChatSession = async (uid: string, sessionId: string, messages: Message[]): Promise<void> => {
  const stored = toStoredMessages(messages);
  const firstUserMessage = stored.find(m => m.role === 'user');
  if (!firstUserMessage) return; // nothing meaningful to save yet

  let title = firstUserMessage.content.replace(/\s+/g, ' ').trim();
  if (title.length > 60) title = `${title.slice(0, 57).trimEnd()}...`;

  await setDoc(doc(chatsCollection(uid), sessionId), {
    title,
    messages: stored,
    messageCount: stored.length,
    updatedAt: Date.now(),
  });
};

/** Lists past chat sessions, newest first. */
export const listChatSessions = async (uid: string): Promise<ChatSession[]> => {
  const snapshot = await getDocs(query(chatsCollection(uid), orderBy('updatedAt', 'desc'), limit(50)));
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }) as ChatSession);
};

export const deleteChatSession = async (uid: string, sessionId: string): Promise<void> => {
  await deleteDoc(doc(chatsCollection(uid), sessionId));
};
