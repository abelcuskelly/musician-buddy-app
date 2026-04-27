import { useState, useCallback } from 'react';
import { useProfile } from '../context/ProfileContext.js';
import { Message } from '../types.js';

export const useMusicianBuddy = (messages: Message[], setMessages: React.Dispatch<React.SetStateAction<Message[]>>) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { profile } = useProfile();

  const sendMessage = useCallback(async (userInput: string) => {
    setIsLoading(true);
    setError(null);

    const modelMessageId = `model-${Date.now()}`;
    setMessages(prev => [...prev, { id: modelMessageId, role: 'model', content: '', isStreaming: true }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userInput, profile, history: messages }),
      });

      const contentType = response.headers.get('Content-Type');

      // Handle JSON Response (Music Generation)
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        setMessages(prev => prev.map(msg => 
          msg.id === modelMessageId ? { ...msg, content: data.content, audioData: data.audioData, isStreaming: false } : msg
        ));
      } 
      // Handle Stream Response (Standard Chat)
      else {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullResponse += decoder.decode(value, { stream: true });
            setMessages(prev => prev.map(msg => 
              msg.id === modelMessageId ? { ...msg, content: fullResponse } : msg
            ));
          }
        }
        setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, isStreaming: false } : msg));
      }
    } catch (e: any) {
      setError("Error communicating with server.");
      setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, content: "Error.", isStreaming: false } : msg));
    } finally {
      setIsLoading(false);
    }
  }, [profile, messages, setMessages]);

  return { sendMessage, isLoading, error };
};
