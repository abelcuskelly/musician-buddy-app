
import React, { useState, useRef, useEffect } from 'react';
import SendIcon from './icons/SendIcon.tsx';
import MicrophoneIcon from './icons/MicrophoneIcon.tsx';

interface UserInputProps {
  onSendMessage: (input: string) => void;
  isLoading: boolean;
}

const UserInput: React.FC<UserInputProps> = ({ onSendMessage, isLoading }) => {
  const [input, setInput] = useState('');
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let interimTranscript = '';
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        setInput(input + finalTranscript + interimTranscript);
      };

      recognition.onend = () => {
        setIsListening(false);
      };
      
      recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, [input]);

  const handleMicClick = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    } else {
      if (recognitionRef.current) {
        recognitionRef.current.start();
        setIsListening(true);
      } else {
        alert("Sorry, your browser doesn't support voice recognition.");
      }
    }
  };

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

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-3">
      <div className="relative flex-1">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask for a lesson, critique, or start a song..."
          className="w-full bg-[#313244] text-[#cdd6f4] placeholder:text-gray-500 rounded-lg py-3 pl-4 pr-24 resize-none focus:outline-none focus:ring-2 focus:ring-[#89b4fa] transition-all duration-200 max-h-40"
          rows={1}
          disabled={isLoading}
          aria-label="Chat input"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          <button
            type="button"
            onClick={handleMicClick}
            disabled={isLoading}
            className={`p-2 rounded-full transition-colors ${isListening ? 'bg-red-500/80 text-white' : 'hover:bg-white/10 text-[#cdd6f4]'} disabled:opacity-50`}
            aria-label={isListening ? 'Stop listening' : 'Start listening'}
          >
            <MicrophoneIcon className="w-5 h-5" />
          </button>
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
    </form>
  );
};

export default UserInput;
