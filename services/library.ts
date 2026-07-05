import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  query,
  orderBy,
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../lib/firebase.ts';
import { SavedItem, SavedItemType } from '../types.ts';

const NOT_CONFIGURED_ERROR = 'Saving is not configured yet. See AUTH_SETUP.md for Firebase setup instructions.';

const libraryCollection = (uid: string) => {
  if (!db) throw new Error(NOT_CONFIGURED_ERROR);
  return collection(db, 'users', uid, 'library');
};

export interface SaveArtifactParams {
  type: SavedItemType;
  title: string;
  content: string; // exactly the artifact text (plan/sheet), not the whole chat reply
  audioData?: string; // base64 MP3 for generated tracks
}

/**
 * Saves a specific artifact (lesson plan, song sheet, or audio clip) to the
 * user's library. Audio is uploaded to Firebase Storage; text to Firestore.
 */
export const saveArtifactToLibrary = async (uid: string, params: SaveArtifactParams): Promise<SavedItem> => {
  const itemRef = doc(libraryCollection(uid));

  let audioUrl: string | undefined;
  let audioPath: string | undefined;

  if (params.audioData) {
    if (!storage) throw new Error(NOT_CONFIGURED_ERROR);
    audioPath = `users/${uid}/audio/${itemRef.id}.mp3`;
    const audioRef = ref(storage, audioPath);
    await uploadString(audioRef, params.audioData, 'base64', { contentType: 'audio/mp3' });
    audioUrl = await getDownloadURL(audioRef);
  }

  const item: SavedItem = {
    id: itemRef.id,
    type: params.type,
    title: params.title,
    content: params.content,
    createdAt: Date.now(),
    ...(audioUrl ? { audioUrl, audioPath } : {}),
  };

  const { id, ...data } = item;
  await setDoc(itemRef, data);
  return item;
};

/** Lists all saved items in the user's library, newest first. */
export const listLibraryItems = async (uid: string): Promise<SavedItem[]> => {
  const snapshot = await getDocs(query(libraryCollection(uid), orderBy('createdAt', 'desc')));
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }) as SavedItem);
};

/** Deletes a saved item, including its audio file in Storage if present. */
export const deleteLibraryItem = async (uid: string, item: SavedItem): Promise<void> => {
  await deleteDoc(doc(libraryCollection(uid), item.id));
  if (item.audioPath && storage) {
    try {
      await deleteObject(ref(storage, item.audioPath));
    } catch (error) {
      // The Firestore record is already gone; a leftover audio file is harmless.
      console.warn('Failed to delete audio file from storage:', error);
    }
  }
};
