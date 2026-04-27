import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Chat, Content } from '@google/genai';
import { getSystemInstruction } from './constants.js';
import { Profile, Message } from './types.js';

const app = express();
const PORT = process.env.PORT || 8080;

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY, vertexai: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.join(__dirname, '..', 'dist');

app.use(express.static(clientDistPath));
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  try {
    const { message, profile, history } = req.body as { message: string; profile: Profile | null; history: Message[] };
    
    // 1. Intent Detection: Is the user asking to generate music?
    const musicKeywords = ['generate', 'compose', 'write a song', 'create a tune', 'make a beat', 'audio clip', 'lyrics for'];
    const isMusicRequest = musicKeywords.some(kw => message.toLowerCase().includes(msg => message.toLowerCase().includes(kw)));

    if (isMusicRequest) {
      console.log("[Router] Routing to Lyria 3 for music generation...");
      
      // Call Lyria 3 (or the audio-capable Gemini model)
      const musicModel = ai.getGenerativeModel({ model: "gemini-2.0-flash" }); // Lyria capabilities are integrated here
      const result = await musicModel.generateContent([
        { text: `Generate high-fidelity audio and lyrics based on this request: ${message}. Context: User plays ${profile?.instrument} at ${profile?.skillLevel} level.` }
      ]);

      const response = result.response;
      let audioBase64 = "";
      
      // Extract audio data if present in the multimodal response
      const audioPart = response.candidates?.[0]?.content?.parts.find(p => p.inlineData?.mimeType?.startsWith('audio/'));
      if (audioPart) {
        audioBase64 = audioPart.inlineData.data;
      }

      // Return structured JSON for music generation
      return res.json({
        content: response.text(),
        audioData: audioBase64
      });
    }

    // 2. Standard Conversational Path (Gemini 3.1 Pro)
    const systemInstruction = getSystemInstruction(profile);
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
      model: 'gemini-3.1-pro-preview',
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
    console.error('Error in /api/chat:', error);
    res.status(500).json({ error: { message: error.message } });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
