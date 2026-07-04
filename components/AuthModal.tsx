import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.tsx';
import GoogleIcon from './icons/GoogleIcon.tsx';
import AppleIcon from './icons/AppleIcon.tsx';
import CloseIcon from './icons/CloseIcon.tsx';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Apple sign-in is hidden until an Apple Developer account is set up
// (the provider also needs to be configured in the Firebase Console).
const APPLE_SIGN_IN_ENABLED = false;

const friendlyAuthError = (error: any): string => {
  const code: string = error?.code || '';
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Incorrect email or password. Please try again.';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in instead.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/operation-not-allowed':
      return 'This sign-in method is not enabled yet. Enable it in the Firebase Console (see AUTH_SETUP.md).';
    default:
      return error?.message || 'Something went wrong. Please try again.';
  }
};

const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { isFirebaseConfigured, signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const runAuthAction = async (action: () => Promise<void>) => {
    setError(null);
    setIsSubmitting(true);
    try {
      await action();
      onClose();
    } catch (e: any) {
      setError(friendlyAuthError(e));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEmailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runAuthAction(() =>
      mode === 'signin' ? signInWithEmail(email, password) : signUpWithEmail(name, email, password)
    );
  };

  const providerButtonClass =
    'w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      aria-modal="true"
      role="dialog"
      onClick={onClose}
    >
      <div
        className="bg-[#1e1e2e] rounded-2xl shadow-lg w-full max-w-md border border-gray-700/50 animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-gray-700/50 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[#cdd6f4]">
              {mode === 'signin' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              Sign in to save your songs, audio clips, and lesson plans to your profile.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-gray-400 hover:text-[#cdd6f4] transition-colors"
            aria-label="Close sign in"
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {!isFirebaseConfigured && (
            <div className="p-3 rounded-lg bg-[#f9e2af]/10 border border-[#f9e2af]/30 text-[#f9e2af] text-sm">
              Sign-in isn't configured yet. Add your Firebase credentials to the environment
              (see <code className="font-mono">AUTH_SETUP.md</code>) to enable accounts.
            </div>
          )}

          <button
            type="button"
            onClick={() => runAuthAction(signInWithGoogle)}
            disabled={isSubmitting || !isFirebaseConfigured}
            className={`${providerButtonClass} bg-white text-gray-800 hover:bg-gray-100`}
          >
            <GoogleIcon className="w-5 h-5" />
            Continue with Google
          </button>

          {APPLE_SIGN_IN_ENABLED && (
            <button
              type="button"
              onClick={() => runAuthAction(signInWithApple)}
              disabled={isSubmitting || !isFirebaseConfigured}
              className={`${providerButtonClass} bg-black text-white border border-gray-600 hover:bg-gray-900`}
            >
              <AppleIcon className="w-5 h-5" />
              Continue with Apple
            </button>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-700/70"></div>
            <span className="text-xs text-gray-500 uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-gray-700/70"></div>
          </div>

          <form onSubmit={handleEmailSubmit} className="space-y-3">
            {mode === 'signup' && (
              <div>
                <label htmlFor="auth-name" className="block text-sm font-medium text-[#cdd6f4] mb-1">Name</label>
                <input
                  type="text"
                  id="auth-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#313244] border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-[#89b4fa] focus:outline-none"
                  placeholder="Your name"
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label htmlFor="auth-email" className="block text-sm font-medium text-[#cdd6f4] mb-1">Email</label>
              <input
                type="email"
                id="auth-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-[#313244] border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-[#89b4fa] focus:outline-none"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label htmlFor="auth-password" className="block text-sm font-medium text-[#cdd6f4] mb-1">Password</label>
              <input
                type="password"
                id="auth-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full bg-[#313244] border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-[#89b4fa] focus:outline-none"
                placeholder={mode === 'signup' ? 'At least 6 characters' : 'Your password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            </div>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={isSubmitting || !isFirebaseConfigured}
              className="w-full px-4 py-2.5 rounded-lg bg-gradient-to-br from-[#89b4fa] to-[#b4befe] text-gray-900 font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Please wait...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-sm text-gray-400 text-center">
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null); }}
              className="text-[#89b4fa] hover:underline font-medium"
            >
              {mode === 'signin' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
