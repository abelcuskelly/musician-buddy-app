
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Chat, Content } from '@google/genai';
import { getSystemInstruction } from './constants.js'; // <-- .js added here
import { Profile, Message } from './types.js'; // <-- .js added here

const app = express();
const PORT = process.env.PORT || 8080;

const API_KEY = process.env.API_KEY;
if (!API_KEY) {
  throw new Error("API_KEY environment variable not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY, vertexai: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Vite builds to `dist`, so we serve from there.
const clientDistPath = path.join(__dirname, '..', 'dist');

app.use(express.static(clientDistPath));
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  try {
    const { message, profile, history } = req.body as { message: string; profile: Profile | null; history: Message[] };

    const systemInstruction = getSystemInstruction(profile);

    // Convert our Message[] format to Gemini's Content[] format
    const geminiHistory: Content[] = history.map(msg => ({
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

  } catch (error) {
    console.error('Error in /api/chat:', error);
    res.status(500).send('An error occurred while processing your request.');
  }
});

// The "catchall" handler: for any request that doesn't match one above,
// send back React's index.html file.
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
