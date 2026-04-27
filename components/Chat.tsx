import React, { useState, useEffect, useRef } from 'react';
import { useMusicianBuddy } from '../hooks/useMusicianBuddy.js';
import { useProfile } from '../context/ProfileContext.js';
import { Message as MessageType } from '../types.js';
import Message from './Message.js';
import UserInput from './UserInput.js';
import SettingsModal from './SettingsModal.js';
import SettingsIcon from './icons/SettingsIcon.js';
import BotIcon from './icons/BotIcon.js';

const Chat: React.FC = () => {
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { isLoading, sendMessage, error } = useMusicianBuddy(messages, setMessages);
  const { isProfileComplete } = useProfile();
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    
    // Fix: Use a unique ID with a prefix and random string to avoid collisions
    const userMessage: MessageType = { 
      id: `user-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`, 
      role: 'user', 
      content: input 
    };
    
    // Trigger the API call with the current history
    sendMessage(input);
    // Optimistically add the user message to the UI
    setMessages(prev => [...prev, userMessage]);
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
        <button
          onClick={() => setIsSettingsOpen(true)}
          className="p-2 rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#181825] focus:ring-[#89b4fa] transition-colors"
          aria-label="Open settings"
        >
          <SettingsIcon className="w-6 h-6 text-[#cdd6f4]" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((msg) => (
          <Message key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </main>

      <footer className="p-4 border-t border-gray-700/50 bg-[#1e1e2e]/50">
        {error && <p className="text-center text-red-400 text-sm mb-2">{error}</p>}
        <UserInput onSendMessage={handleSendMessage} isLoading={isLoading} />
      </footer>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
};

export default Chat;
