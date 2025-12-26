
import { useState, useCallback } from 'react';
import { useProfile } from '../context/ProfileContext.tsx';
import { Message } from '../types.ts';

export const useMusicianBuddy = (messages: Message[], setMessages: React.Dispatch<React.SetStateAction<Message[]>>) => {
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const { profile } = useProfile();

  const sendMessage = useCallback(async (message: string) => {
    setIsLoading(true);
    setError(null);

    const modelMessageId = Date.now().toString();
    
    // The user message is added to the state in the Chat component.
    // The model placeholder is added here before the API call.
    setMessages(prev => [...prev, { id: modelMessageId, role: 'model', content: '', isStreaming: true }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          profile,
          // Send the history up to the point before the user sent the new message.
          history: messages, 
        }),
      });

      if (!response.ok || !response.body) {
        const errorText = await response.text();
        throw new Error(`Server error: ${response.statusText} - ${errorText}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        const chunkText = decoder.decode(value, { stream: true });
        fullResponse += chunkText;
        // Update the streaming message in place
        setMessages(prev =>
          prev.map(msg =>
            msg.id === modelMessageId ? { ...msg, content: fullResponse } : msg
          )
        );
      }
    } catch (e: any) {
      console.error(e);
      const errorMessage = "Sorry, I encountered an error communicating with the server. Please try again.";
      setError(errorMessage);
      setMessages(prev =>
        prev.map(msg =>
          msg.id === modelMessageId ? { ...msg, content: errorMessage, isStreaming: false } : msg
        )
      );
    } finally {
      setIsLoading(false);
      // Finalize the streaming message
      setMessages(prev =>
        prev.map(msg =>
          msg.id === modelMessageId ? { ...msg, isStreaming: false } : msg
        )
      );
    }
  }, [profile, messages, setMessages]);

  return { sendMessage, isLoading, error };
};
