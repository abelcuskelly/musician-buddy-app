
import React, { createContext, useState, useContext, ReactNode, useEffect } from 'react';
import { Profile, SkillLevel, FeedbackPreference } from '../types.ts';

interface ProfileContextType {
  profile: Profile | null;
  setProfile: (profile: Profile) => void;
  isProfileComplete: boolean;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const ProfileProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [profile, setProfileState] = useState<Profile | null>(() => {
    try {
      const savedProfile = localStorage.getItem('musicianProfile');
      return savedProfile ? JSON.parse(savedProfile) : null;
    } catch (error) {
      console.error("Failed to parse profile from localStorage", error);
      return null;
    }
  });

  const setProfile = (newProfile: Profile) => {
    setProfileState(newProfile);
    localStorage.setItem('musicianProfile', JSON.stringify(newProfile));
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
