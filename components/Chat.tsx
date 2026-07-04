import React, { useState, useEffect, useRef } from 'react';
import { useMusicianBuddy } from '../hooks/useMusicianBuddy.js';
import { useProfile } from '../context/ProfileContext.js';
import { useAuth } from '../context/AuthContext.tsx';
import { Message as MessageType } from '../types.js';
import Message from './Message.js';
import UserInput from './UserInput.js';
import SettingsModal from './SettingsModal.js';
import AuthModal from './AuthModal.tsx';
import LibraryModal from './LibraryModal.tsx';
import SettingsIcon from './icons/SettingsIcon.js';
import BotIcon from './icons/BotIcon.js';
import LibraryIcon from './icons/LibraryIcon.tsx';
import LogoutIcon from './icons/LogoutIcon.tsx';

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const { isLoading, sendMessage, error } = useMusicianBuddy(messages, setMessages);
  const { isProfileComplete } = useProfile();
  const { user, signOut } = useAuth();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isUserMenuOpen]);

  useEffect(() => {
    if (!isProfileComplete) {
      setIsSettingsOpen(true);
    }
  }, [isProfileComplete]);

  useEffect(() => {
    if (messages.length === 0 && isProfileComplete) {
        setMessages([{
            id: 'initial-greeting',
            role: 'model',
            content: "Hey there! I'm your Musician Buddy. I'm all set up with your profile. What are we working on today? Feel free to ask for a lesson plan, help with a song, or anything else!"
        }]);
    }
  }, [isProfileComplete, messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (input: string) => {
    if (!input.trim() || isLoading) return;
    
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 7);
    
    const userMessage: MessageType = { 
      id: `user-${timestamp}-${randomStr}`, 
      role: 'user', 
      content: input 
    };

    const modelMessageId = `model-${timestamp}-${randomStr}`;
    const modelPlaceholder: MessageType = {
      id: modelMessageId,
      role: 'model',
      content: '',
      isStreaming: true
    };
    
    // Add both messages to state at once to guarantee order (User then Model)
    setMessages(prev => [...prev, userMessage, modelPlaceholder]);
    
    // Trigger the API call
    sendMessage(input, modelMessageId);
  };

  return (
    <div className="flex flex-col h-[95vh] w-full max-w-4xl mx-auto bg-[#181825] rounded-2xl shadow-2xl shadow-black/50 border border-gray-700/50 overflow-hidden">
      <header className="flex items-center justify-between p-4 border-b border-gray-700/50 bg-[#1e1e2e]/50 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-[#89b4fa] to-[#b4befe] rounded-lg">
            <BotIcon className="w-6 h-6 text-gray-900" />
          </div>
          <h1 className="text-xl font-bold text-[#cdd6f4]">AI Musician Buddy</h1>
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <button
              onClick={() => setIsLibraryOpen(true)}
              className="p-2 rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#181825] focus:ring-[#89b4fa] transition-colors"
              aria-label="Open my library"
              title="My Library"
            >
              <LibraryIcon className="w-6 h-6 text-[#cdd6f4]" />
            </button>
          )}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#181825] focus:ring-[#89b4fa] transition-colors"
            aria-label="Open settings"
          >
            <SettingsIcon className="w-6 h-6 text-[#cdd6f4]" />
          </button>
          {user ? (
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setIsUserMenuOpen(prev => !prev)}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-[#a6e3a1] to-[#94e2d5] text-gray-900 font-bold text-sm flex items-center justify-center hover:opacity-90 transition-opacity overflow-hidden"
                aria-label="Open account menu"
                aria-expanded={isUserMenuOpen}
              >
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  (user.displayName || user.email || '?').charAt(0).toUpperCase()
                )}
              </button>
              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-[#1e1e2e] border border-gray-700/50 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-700/50">
                    <p className="text-sm font-medium text-[#cdd6f4] truncate">{user.displayName || 'Musician'}</p>
                    <p className="text-xs text-gray-400 truncate">{user.email}</p>
                  </div>
                  <button
                    onClick={() => { setIsUserMenuOpen(false); setIsLibraryOpen(true); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-[#cdd6f4] hover:bg-white/5 transition-colors"
                  >
                    <LibraryIcon className="w-4 h-4" />
                    My Library
                  </button>
                  <button
                    onClick={() => { setIsUserMenuOpen(false); signOut(); }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:bg-white/5 transition-colors"
                  >
                    <LogoutIcon className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setIsAuthOpen(true)}
              className="px-4 py-1.5 rounded-lg bg-gradient-to-br from-[#89b4fa] to-[#b4befe] text-gray-900 text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg) => (
          <Message key={msg.id} message={msg} onRequireSignIn={() => setIsAuthOpen(true)} />
        ))}
        <div ref={messagesEndRef} />
      </main>

      <footer className="p-4 border-t border-gray-700/50 bg-[#1e1e2e]/50">
        {error && <p className="text-center text-red-400 text-sm mb-2">{error}</p>}
        <UserInput onSendMessage={handleSendMessage} isLoading={isLoading} />
      </footer>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
      <LibraryModal isOpen={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} />
    </div>
  );
};

export default Chat;
