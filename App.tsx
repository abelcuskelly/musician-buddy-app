
import React from 'react';
import { AuthProvider } from './context/AuthContext.tsx';
import { ProfileProvider } from './context/ProfileContext.tsx';
import Chat from './components/Chat.tsx';

const App: React.FC = () => {
  return (
    <AuthProvider>
      <ProfileProvider>
        <div className="min-h-screen bg-[#11111b] flex flex-col items-center justify-center">
          <Chat />
        </div>
      </ProfileProvider>
    </AuthProvider>
  );
};

export default App;
