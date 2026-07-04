
import React from 'react';
import { AuthProvider } from './context/AuthContext.tsx';
import { ProfileProvider } from './context/ProfileContext.tsx';
import Chat from './components/Chat.tsx';
import SharePage from './components/SharePage.tsx';

const App: React.FC = () => {
  // Public share pages (/share/:id) render without auth or profile setup.
  const shareMatch = window.location.pathname.match(/^\/share\/([^/]+)\/?$/);
  if (shareMatch) {
    return <SharePage shareId={decodeURIComponent(shareMatch[1])} />;
  }

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
