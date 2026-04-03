import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Chat, Content } from '@google/genai';
import { getSystemInstruction } from './constants';
import { Profile, Message } from './types';

const app = express();
const PORT = process.env.PORT || 8080;

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error("API_KEY environment variable not set.");
}

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

    const firstUserTurnIndex = history.findIndex(msg => msg.role === 'user');
    const validHistory = firstUserTurnIndex === -1 ? [] : history.slice(firstUserTurnIndex);

    const geminiHistory: Content[] = validHistory.map(msg => ({
      role: msg.role,
      parts: [{ text: msg.content }]
    }));

    const chat: Chat = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: systemInstruction,
      },
      history: geminiHistory
    });

    const stream = await chat.sendMessageStream({ message });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of stream) {
      res.write(chunk.text);
    }
    res.end();

  } catch (error: any) {
    console.error('Error in /api/chat:', error);
    res.status(500).send(error.message || 'An error occurred while processing your request.');
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
