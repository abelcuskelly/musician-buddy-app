import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Chat, Content } from '@google/genai';
import { getSystemInstruction } from './constants.js';
import { Profile, Message } from './types.js';

const app = express();
const PORT = process.env.PORT || 8080;

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error("API_KEY environment variable not set.");
}

// Mandatory initialization per instructions
const ai = new GoogleGenAI({ apiKey: API_KEY, vertexai: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.join(__dirname, '..', 'dist');

app.use(express.static(clientDistPath));
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  try {
    const { message, profile, history } = req.body as { message: string; profile: Profile | null; history: Message[] };
    const systemInstruction = getSystemInstruction(profile);

    // --- ROBUST HISTORY SANITIZATION ---
    const firstUserIndex = history.findIndex(m => m.role === 'user');
    let sanitizedHistory = firstUserIndex === -1 ? [] : history.slice(firstUserIndex);

    const alternatingHistory: Message[] = [];
    for (const msg of sanitizedHistory) {
      if (alternatingHistory.length > 0 && alternatingHistory[alternatingHistory.length - 1].role === msg.role) {
        alternatingHistory[alternatingHistory.length - 1] = msg;
      } else {
        alternatingHistory.push(msg);
      }
    }

    while (alternatingHistory.length > 0 && alternatingHistory[alternatingHistory.length - 1].role !== 'model') {
      alternatingHistory.pop();
    }

    const geminiHistory: Content[] = alternatingHistory.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    const chat: Chat = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: { systemInstruction },
      history: geminiHistory
    });

    const stream = await chat.sendMessageStream({ message });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of stream) {
      if (chunk.text) res.write(chunk.text);
    }
    res.end();

  } catch (error: any) {
    console.error('Detailed Error in /api/chat:', error);
    res.status(error.status || 500).json({ error: { message: error.message } });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
