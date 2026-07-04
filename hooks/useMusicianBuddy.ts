import { useState, useCallback } from 'react';
import { useProfile } from '../context/ProfileContext.js';
import { Message } from '../types.js';

export const useMusicianBuddy = (messages: Message[], setMessages: React.Dispatch<React.SetStateAction<Message[]>>) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { profile } = useProfile();

  const sendMessage = useCallback(async (userInput: string, modelMessageId: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const baseUrl = window.location.origin;
      const apiUrl = `${baseUrl}/api/chat`.replace(/([^:]\/)\/+/g, "$1");

      // CRITICAL: Strip audioData from history before sending to server to prevent PayloadTooLargeError
      const sanitizedHistory = messages.map(({ audioData, ...rest }) => rest);

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userInput,
          profile,
          history: sanitizedHistory
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || "Server error");
      }

      const contentType = response.headers.get('Content-Type');

      if (contentType?.includes('application/json')) {
        const data = await response.json();
        setMessages(prev => prev.map(msg => 
          msg.id === modelMessageId 
            ? { ...msg, content: data.content, audioData: data.audioData, lyricsSheet: data.lyricsSheet, isStreaming: false } 
            : msg
        ));
      } else {
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let fullResponse = '';

        if (reader) {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            fullResponse += decoder.decode(value, { stream: true });
            setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, content: fullResponse } : msg));
          }
        }
        setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, isStreaming: false } : msg));
      }
    } catch (e: any) {
      console.error("Chat Error:", e);
      const errorMsg = e.message || "Sorry, I encountered an error communicating with the server.";
      setError(errorMsg);
      setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, content: errorMsg, isStreaming: false } : msg));
    } finally {
      setIsLoading(false);
    }
  }, [profile, messages, setMessages]);

  return { sendMessage, isLoading, error };
};
