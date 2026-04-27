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

// Initialize standard Gemini API
const ai = new GoogleGenAI({ apiKey: API_KEY, vertexai: false });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.join(__dirname, '..', 'dist');

app.use(express.static(clientDistPath));
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  try {
    const { message, profile, history } = req.body as { message: string; profile: Profile | null; history: Message[] };

    // --- SMART ROUTER: Intent Detection for Lyria 3 ---
    const musicKeywords = ['generate', 'compose', 'create a song', 'write a song', 'make a tune', 'audio clip', 'produce a track', 'create a beat'];
    const isMusicRequest = musicKeywords.some((kw: string) => message.toLowerCase().includes(kw));
    const isClipRequest = message.toLowerCase().includes('clip') || message.toLowerCase().includes('30 second') || message.toLowerCase().includes('loop');

    if (isMusicRequest) {
      const modelId = isClipRequest ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
      console.log(`[Router] Routing to ${modelId} for music generation...`);

      // Use generateContent as per Lyria 3 documentation
      const result = await ai.models.generateContent({
        model: modelId,
        contents: [{
          role: 'user',
          parts: [{ 
            text: `Generate music based on this request: ${message}. 
            User Context: ${profile?.skillLevel || 'Beginner'} ${profile?.instrument || 'musician'}. 
            Genres: ${profile?.musicGenres || 'various'}.
            Ensure high-fidelity 44.1kHz output. Include lyrics and structure in the text response.` 
          }]
        }]
      });

      let audioBase64 = "";
      let textContent = "";

      // Parse multimodal outputs from the response parts
      if (result.candidates?.[0]?.content?.parts) {
        for (const part of result.candidates[0].content.parts) {
          if (part.text) {
            textContent += part.text;
          } else if (part.inlineData) {
            audioBase64 = part.inlineData.data;
          }
        }
      }

      return res.json({
        content: textContent || "Composition complete! You can listen to or download your track below.",
        audioData: audioBase64
      });
    }

    // --- CONVERSATIONAL PATH: Gemini 3.1 Pro ---
    const systemInstruction = getSystemInstruction(profile);
    const firstUserIndex = history.findIndex((m: Message) => m.role === 'user');
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

    const geminiHistory: Content[] = alternatingHistory.map((msg: Message) => ({
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
