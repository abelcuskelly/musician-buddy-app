
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { SpeechRecorder, transcribeAudio } from '../lib/voice.ts';
import SendIcon from './icons/SendIcon.tsx';
import MicrophoneIcon from './icons/MicrophoneIcon.tsx';

interface UserInputProps {
  onSendMessage: (input: string) => void;
  isLoading: boolean;
  /** In hands-free mode, transcripts are sent automatically. */
  handsFree: boolean;
  /** Incremented by the parent to auto-start listening (hands-free loop). */
  listenSignal: number;
}

type VoiceState = 'idle' | 'recording' | 'transcribing';

const UserInput: React.FC<UserInputProps> = ({ onSendMessage, isLoading, handsFree, listenSignal }) => {
  const [input, setInput] = useState('');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const recorderRef = useRef<SpeechRecorder | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const startListening = useCallback(async () => {
    if (recorderRef.current || isLoading) return;
    setVoiceError(null);

    const recorder = new SpeechRecorder();
    recorderRef.current = recorder;
    try {
      await recorder.start();
      setVoiceState('recording');

      const result = await recorder.waitForResult();
      recorderRef.current = null;

      if (!result) {
        setVoiceState('idle');
        return;
      }

      setVoiceState('transcribing');
      const transcript = await transcribeAudio(result);
      setVoiceState('idle');

      if (!transcript) return;
      if (handsFree) {
        onSendMessage(transcript);
      } else {
        setInput(prev => (prev ? `${prev} ${transcript}` : transcript));
        textareaRef.current?.focus();
      }
    } catch (e: any) {
      console.error('Voice input error:', e);
      recorderRef.current = null;
      setVoiceState('idle');
      setVoiceError(
        e?.name === 'NotAllowedError'
          ? 'Microphone access was denied. Please allow it in your browser settings.'
          : e.message || 'Voice input failed. Please try again.'
      );
    }
  }, [handsFree, isLoading, onSendMessage]);

  const handleMicClick = () => {
    if (voiceState === 'recording') {
      recorderRef.current?.stop();
    } else if (voiceState === 'idle') {
      startListening();
    }
  };

  // Hands-free loop: the parent bumps listenSignal after speaking a reply.
  useEffect(() => {
    if (listenSignal > 0 && handsFree && !isLoading) {
      startListening();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenSignal]);

  // Stop any active recording when hands-free mode is switched off.
  useEffect(() => {
    if (!handsFree && voiceState === 'recording') {
      recorderRef.current?.stop();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handsFree]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  const placeholder = voiceState === 'recording'
    ? 'Listening... (stops automatically when you pause)'
    : voiceState === 'transcribing'
      ? 'Transcribing your voice...'
      : handsFree
        ? 'Hands-free mode on — tap the mic or just type...'
        : 'Ask for a lesson, critique, or start a song...';

  return (
    <form onSubmit={handleSubmit}>
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="w-full bg-[#313244] text-[#cdd6f4] placeholder:text-gray-500 rounded-lg py-3 pl-4 pr-24 resize-none focus:outline-none focus:ring-2 focus:ring-[#89b4fa] transition-all duration-200 max-h-40"
          rows={1}
          disabled={isLoading}
          aria-label="Chat input"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {handsFree && (
            <button
              type="button"
              onClick={handleMicClick}
              disabled={isLoading || voiceState === 'transcribing'}
              className={`p-2 rounded-full transition-colors ${
                voiceState === 'recording'
                  ? 'bg-red-500/80 text-white animate-pulse'
                  : voiceState === 'transcribing'
                    ? 'bg-[#89b4fa]/30 text-[#89b4fa] animate-pulse'
                    : 'hover:bg-white/10 text-[#cdd6f4]'
              } disabled:opacity-60`}
              aria-label={voiceState === 'recording' ? 'Stop listening' : 'Start listening'}
            >
              <MicrophoneIcon className="w-5 h-5" />
            </button>
          )}
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="p-2 rounded-full bg-gradient-to-br from-[#89b4fa] to-[#b4befe] text-gray-900 disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            aria-label="Send message"
          >
            <SendIcon className="w-5 h-5" />
          </button>
        </div>
      </div>
      {voiceError && <p className="text-xs text-red-400 mt-1.5">{voiceError}</p>}
    </form>
  );
};

export default UserInput;
