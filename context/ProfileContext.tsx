
import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { Profile } from '../types.ts';
import { db } from '../lib/firebase.ts';
import { useAuth } from './AuthContext.tsx';

interface ProfileContextType {
  profile: Profile | null;
  setProfile: (profile: Profile) => void;
  isProfileComplete: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

const persistToCloud = async (uid: string, profile: Profile, extras: Record<string, unknown> = {}) => {
  if (!db) return;
  try {
    await setDoc(doc(db, 'users', uid), { profile, updatedAt: Date.now(), ...extras }, { merge: true });
  } catch (error) {
    console.error('Failed to sync profile to cloud:', error);
  }
};

export const ProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [profile, setProfileState] = useState<Profile | null>(() => {
    try {
      const savedProfile = localStorage.getItem('musicianProfile');
      return savedProfile ? JSON.parse(savedProfile) : null;
    } catch (error) {
      console.error("Failed to parse profile from localStorage", error);
      return null;
    }
  });

  // When a user signs in, load their profile from Firestore. If they have no
  // cloud profile yet but built one locally, upload the local one.
  useEffect(() => {
    if (!user || !db) return;
    let cancelled = false;

    (async () => {
      try {
        const snapshot = await getDoc(doc(db!, 'users', user.uid));
        const cloudProfile = snapshot.exists() ? (snapshot.data().profile as Profile | undefined) : undefined;
        if (cancelled) return;

        if (cloudProfile) {
          setProfileState(cloudProfile);
          localStorage.setItem('musicianProfile', JSON.stringify(cloudProfile));
        } else {
          const localProfile = localStorage.getItem('musicianProfile');
          if (localProfile) {
            await persistToCloud(user.uid, JSON.parse(localProfile), {
              email: user.email,
              displayName: user.displayName,
            });
          }
        }
      } catch (error) {
        console.error('Failed to load profile from cloud:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const setProfile = (newProfile: Profile) => {
    setProfileState(newProfile);
    localStorage.setItem('musicianProfile', JSON.stringify(newProfile));
    if (user) {
      persistToCloud(user.uid, newProfile, { email: user.email, displayName: user.displayName });
    }
  };

  const isProfileComplete = !!(
    profile &&
    profile.instrument &&
    profile.skillLevel &&
    profile.musicalGoals &&
    profile.musicGenres
  );

  return (
    <ProfileContext.Provider value={{ profile, setProfile, isProfileComplete }}>
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = (): ProfileContextType => {
  const context = useContext(ProfileContext);
  if (context === undefined) {
    throw new Error('useProfile must be used within a ProfileProvider');
  }
  return context;
};
