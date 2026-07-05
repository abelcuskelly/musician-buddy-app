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
import { JamConfig } from '../lib/jamSession.ts';

export interface JamPresetPrompt {
  text: string;
  weight: number;
  muted: boolean;
}

export interface JamMixPreset {
  id: string;
  name: string;
  prompts: JamPresetPrompt[];
  config: JamConfig;
  createdAt: number;
}

const NOT_CONFIGURED_ERROR = 'Saving mixes is not configured yet. See AUTH_SETUP.md for Firebase setup instructions.';

const presetsCollection = (uid: string) => {
  if (!db) throw new Error(NOT_CONFIGURED_ERROR);
  return collection(db, 'users', uid, 'jamPresets');
};

/** Saves the current jam mix (prompts + settings) as a named preset. */
export const saveJamPreset = async (
  uid: string,
  name: string,
  prompts: JamPresetPrompt[],
  config: JamConfig,
): Promise<JamMixPreset> => {
  const presetRef = doc(presetsCollection(uid));
  const preset: JamMixPreset = {
    id: presetRef.id,
    name: name.trim().slice(0, 60) || 'My Mix',
    prompts: prompts.map(p => ({ text: p.text, weight: p.weight, muted: p.muted })),
    // Firestore rejects undefined values; strip optional unset fields.
    config: JSON.parse(JSON.stringify(config)),
    createdAt: Date.now(),
  };
  const { id, ...data } = preset;
  await setDoc(presetRef, data);
  return preset;
};

/** Lists saved jam mixes, newest first. */
export const listJamPresets = async (uid: string): Promise<JamMixPreset[]> => {
  const snapshot = await getDocs(query(presetsCollection(uid), orderBy('createdAt', 'desc'), limit(30)));
  return snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }) as JamMixPreset);
};

export const deleteJamPreset = async (uid: string, presetId: string): Promise<void> => {
  await deleteDoc(doc(presetsCollection(uid), presetId));
};
