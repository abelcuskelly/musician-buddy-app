import { useState, useCallback } from 'react';
import { useProfile } from '../context/ProfileContext.tsx';
import { Message } from '../types.ts';

export const useMusicianBuddy = (messages: Message[], setMessages: React.Dispatch<React.SetStateAction<Message[]>>) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { profile } = useProfile();

  const sendMessage = useCallback(async (userInput: string) => {
    setIsLoading(true);
    setError(null);

    const modelMessageId = Date.now().toString();
    setMessages(prev => [...prev, { id: modelMessageId, role: 'model', content: '', isStreaming: true }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userInput,
          profile,
          history: messages
        }),
      });

      if (!response.ok) throw new Error("Server error");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullResponse += decoder.decode(value, { stream: true });
          setMessages(prev =>
            prev.map(msg => msg.id === modelMessageId ? { ...msg, content: fullResponse } : msg)
          );
        }
      }

      setMessages(prev =>
        prev.map(msg => msg.id === modelMessageId ? { ...msg, isStreaming: false } : msg)
      );
    } catch (e: any) {
      setError("Sorry, I encountered an error communicating with the server.");
      setMessages(prev =>
        prev.map(msg => msg.id === modelMessageId ? { ...msg, content: "Error.", isStreaming: false } : msg)
      );
    } finally {
      setIsLoading(false);
    }
  }, [profile, messages, setMessages]);

  return { sendMessage, isLoading, error };
};
