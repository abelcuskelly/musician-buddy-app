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

      // For music requests, we simulate a thinking process since Lyria doesn't stream
      const musicKeywords = ['generate', 'compose', 'create a song', 'write a song', 'make a tune', 'audio clip', 'produce a track', 'create a beat'];
      const isMusicRequest = musicKeywords.some(kw => userInput.toLowerCase().includes(kw));

      if (isMusicRequest) {
        setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, content: "_Analyzing musical request..._" } : msg));
        setTimeout(() => {
          setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, content: "_Composing structure and lyrics..._" } : msg));
        }, 2000);
        setTimeout(() => {
          setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, content: "_Generating high-fidelity audio with Lyria 3..._" } : msg));
        }, 5000);
      }

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

      const contentType = response.headers.get('Content-Type');

      // Handle JSON Response (Music Generation)
      if (contentType?.includes('application/json')) {
        const data = await response.json();
        setMessages(prev => prev.map(msg => 
          msg.id === modelMessageId 
            ? { ...msg, content: data.content, audioData: data.audioData, isStreaming: false } 
            : msg
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
            setMessages(prev =>
              prev.map(msg => msg.id === modelMessageId ? { ...msg, content: fullResponse } : msg)
            );
          }
        }

        setMessages(prev =>
          prev.map(msg => msg.id === modelMessageId ? { ...msg, isStreaming: false } : msg)
        );
      }
    } catch (e: any) {
      console.error("Chat Error:", e);
      const errorMsg = e.message || "Sorry, I encountered an error communicating with the server.";
      setError(errorMsg);
      setMessages(prev =>
        prev.map(msg => msg.id === modelMessageId ? { ...msg, content: errorMsg, isStreaming: false } : msg)
      );
    } finally {
      setIsLoading(false);
    }
  }, [profile, messages, setMessages]);

  return { sendMessage, isLoading, error };
};
