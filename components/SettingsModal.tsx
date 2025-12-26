
import React, { useState, useEffect } from 'react';
import { useProfile } from '../context/ProfileContext.tsx';
import { Profile, SkillLevel, FeedbackPreference } from '../types.ts';
import { SKILL_LEVELS, FEEDBACK_PREFERENCES } from '../constants.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { profile, setProfile, isProfileComplete } = useProfile();
  const [formData, setFormData] = useState<Profile>({
    instrument: '',
    skillLevel: 'Beginner',
    musicalGoals: '',
    musicGenres: '',
    feedbackPreference: 'Gentle and Encouraging',
  });

  useEffect(() => {
    if (profile) {
      setFormData(profile);
    }
  }, [profile, isOpen]);

  if (!isOpen) return null;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProfile(formData);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      aria-modal="true"
      role="dialog"
    >
      <div className="bg-[#1e1e2e] rounded-2xl shadow-lg w-full max-w-md border border-gray-700/50 animate-fade-in">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-gray-700/50">
            <h2 className="text-2xl font-bold text-[#cdd6f4]">Your Musical Profile</h2>
            <p className="text-sm text-gray-400 mt-1">
              {isProfileComplete ? "Update your details here." : "Help me get to know you as a musician!"}
            </p>
          </div>
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <div>
              <label htmlFor="instrument" className="block text-sm font-medium text-[#cdd6f4] mb-1">Instrument</label>
              <input type="text" name="instrument" id="instrument" value={formData.instrument} onChange={handleChange} required className="w-full bg-[#313244] border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-[#89b4fa] focus:outline-none" placeholder="e.g., Acoustic Guitar, Piano, Vocals" />
            </div>
            <div>
              <label htmlFor="skillLevel" className="block text-sm font-medium text-[#cdd6f4] mb-1">Skill Level</label>
              <select name="skillLevel" id="skillLevel" value={formData.skillLevel} onChange={handleChange} required className="w-full bg-[#313244] border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-[#89b4fa] focus:outline-none appearance-none">
                {SKILL_LEVELS.map(level => <option key={level} value={level}>{level}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="musicalGoals" className="block text-sm font-medium text-[#cdd6f4] mb-1">Musical Goals</label>
              <textarea name="musicalGoals" id="musicalGoals" value={formData.musicalGoals} onChange={handleChange} required rows={3} className="w-full bg-[#313244] border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-[#89b4fa] focus:outline-none" placeholder="e.g., Write my first song, learn music theory, prepare for an audition"></textarea>
            </div>
            <div>
              <label htmlFor="musicGenres" className="block text-sm font-medium text-[#cdd6f4] mb-1">Favorite Genres</label>
              <input type="text" name="musicGenres" id="musicGenres" value={formData.musicGenres} onChange={handleChange} required className="w-full bg-[#313244] border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-[#89b4fa] focus:outline-none" placeholder="e.g., Folk, Rock, Jazz" />
            </div>
            <div>
              <label htmlFor="feedbackPreference" className="block text-sm font-medium text-[#cdd6f4] mb-1">Feedback Preference</label>
              <select name="feedbackPreference" id="feedbackPreference" value={formData.feedbackPreference} onChange={handleChange} required className="w-full bg-[#313244] border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-[#89b4fa] focus:outline-none appearance-none">
                {FEEDBACK_PREFERENCES.map(pref => <option key={pref} value={pref}>{pref}</option>)}
              </select>
            </div>
          </div>
          <div className="p-4 bg-[#181825]/50 rounded-b-2xl flex justify-end gap-3">
            {!isProfileComplete && <p className="text-xs text-gray-500 self-center mr-auto">Please fill out your profile to begin.</p>}
            {isProfileComplete && <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-gray-600 hover:bg-gray-500 transition-colors">Cancel</button>}
            <button type="submit" className="px-4 py-2 rounded-lg bg-gradient-to-br from-[#89b4fa] to-[#b4befe] text-gray-900 font-semibold hover:opacity-90 transition-opacity">Save Profile</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;
