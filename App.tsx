
import React, { useState, useEffect, useCallback } from 'react';
import { AuthProvider } from './context/AuthContext.tsx';
import { ProfileProvider } from './context/ProfileContext.tsx';
import Chat from './components/Chat.tsx';
import SharePage from './components/SharePage.tsx';
import JamMode from './components/JamMode.tsx';

const App: React.FC = () => {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    setPath(to);
  }, []);

  // Public share pages (/share/:id) render without auth or profile setup.
  const shareMatch = path.match(/^\/share\/([^/]+)\/?$/);
  if (shareMatch) {
    return <SharePage shareId={decodeURIComponent(shareMatch[1])} />;
  }

  if (path === '/jam') {
    return (
      <AuthProvider>
        <JamMode onEndJam={() => navigate('/')} />
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <ProfileProvider>
        <div className="min-h-screen bg-[#11111b] flex flex-col items-center justify-center">
          <Chat onStartJam={() => navigate('/jam')} />
        </div>
      </ProfileProvider>
    </AuthProvider>
  );
};

export default App;
