
import React from 'react';
import { ProfileProvider } from './context/ProfileContext.tsx';
import Chat from './components/Chat.tsx';

const App: React.FC = () => {
  return (
    <ProfileProvider>
      <div className="min-h-screen bg-[#11111b] flex flex-col items-center justify-center">
        <Chat />
      </div>
    </ProfileProvider>
  );
};

export default App;
