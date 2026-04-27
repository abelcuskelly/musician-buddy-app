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

    // Fix: Use a unique ID with a prefix and random string to avoid collisions
    const modelMessageId = `model-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    
    // Add the empty model message placeholder to the history
    setMessages(prev => [...prev, { id: modelMessageId, role: 'model', content: '', isStreaming: true }]);

    try {
      const baseUrl = window.location.origin;
      const apiUrl = `${baseUrl}/api/chat`.replace(/([^:]\/)\/+/g, "$1");

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userInput,
          profile,
          history: messages
        }),
      });

      if (!response.ok) {
        let errorMessage = "Server error";
        try {
          const errorData = await response.json();
          errorMessage = errorData.error?.message || errorMessage;
        } catch (e) {
          errorMessage = await response.text() || errorMessage;
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullResponse += decoder.decode(value, { stream: true });
          
          // Update the specific model message by ID in the state
          setMessages(prev =>
            prev.map(msg => msg.id === modelMessageId ? { ...msg, content: fullResponse } : msg)
          );
        }
      }

      // Mark streaming as finished for this specific message
      setMessages(prev =>
        prev.map(msg => msg.id === modelMessageId ? { ...msg, isStreaming: false } : msg)
      );
    } catch (e: any) {
      console.error("Chat Error:", e);
      const errorMsg = e.message || "Sorry, I encountered an error communicating with the server.";
      setError(errorMsg);
      
      // Update the placeholder with the error message
      setMessages(prev =>
        prev.map(msg => msg.id === modelMessageId ? { ...msg, content: errorMsg, isStreaming: false } : msg)
      );
    } finally {
      setIsLoading(false);
    }
  }, [profile, messages, setMessages]);

  return { sendMessage, isLoading, error };
};
