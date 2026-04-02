import { useState, useCallback } from 'react';
import { GoogleGenAI } from '@google/genai';
import { useProfile } from '../context/ProfileContext.js';
import { getSystemInstruction } from '../constants.js';
import { Message } from '../types.js';

const API_KEY = "AIzaSyDL3DYnBVB3d3Udi1tUNEKIkmpRhk98TXY";

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
      const genAI = new GoogleGenAI({ apiKey: API_KEY, vertexai: true });
      const systemInstruction = getSystemInstruction(profile);

      const firstUserIndex = messages.findIndex(m => m.role === 'user');
      let sanitizedHistory = firstUserIndex === -1 ? [] : messages.slice(firstUserIndex);

      const alternatingHistory: any[] = [];
      for (const msg of sanitizedHistory) {
        if (alternatingHistory.length > 0 && alternatingHistory[alternatingHistory.length - 1].role === msg.role) {
          alternatingHistory[alternatingHistory.length - 1] = { role: msg.role, parts: [{ text: msg.content }] };
        } else {
          alternatingHistory.push({ role: msg.role, parts: [{ text: msg.content }] });
        }
      }

      while (alternatingHistory.length > 0 && alternatingHistory[alternatingHistory.length - 1].role !== 'model') {
        alternatingHistory.pop();
      }

      const chat = genAI.chats.create({
        model: 'gemini-2.5-flash',
        config: { systemInstruction },
        history: alternatingHistory,
      });

      const result = await chat.sendMessageStream({ message: userInput });
      
      let fullResponse = '';
      for await (const chunk of result) {
        fullResponse += chunk.text;
        setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, content: fullResponse } : msg));
      }

      setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, isStreaming: false } : msg));
    } catch (e: any) {
      setError(e.message || "Error connecting to AI.");
      setMessages(prev => prev.map(msg => msg.id === modelMessageId ? { ...msg, content: "Error.", isStreaming: false } : msg));
    } finally {
      setIsLoading(false);
    }
  }, [profile, messages, setMessages]);

  return { sendMessage, isLoading, error };
};
