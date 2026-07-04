import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Chat, Content } from '@google/genai';
import { initializeApp as initializeAdminApp, getApps as getAdminApps, App as AdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { getSystemInstruction } from './constants.js';
import { Profile, Message, SavedItemType } from './types.js';

// Load .env for local development (no-op when the file doesn't exist, e.g. on Cloud Run).
try {
  process.loadEnvFile();
} catch {
  // No .env file present; rely on real environment variables.
}

const app = express();
const PORT = process.env.PORT || 8080;

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  throw new Error("GEMINI_API_KEY environment variable not set.");
}

const ai = new GoogleGenAI({ apiKey: API_KEY, vertexai: false });

// --- Firebase Admin (used for the public share feature) ---
// Uses Application Default Credentials: the service account on Cloud Run,
// or `gcloud auth application-default login` locally.
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'api-connector-mcp';
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || 'api-connector-mcp.firebasestorage.app';

let adminApp: AdminApp | null = null;
try {
  adminApp = getAdminApps()[0] ?? initializeAdminApp({
    projectId: FIREBASE_PROJECT_ID,
    storageBucket: FIREBASE_STORAGE_BUCKET,
  });
} catch (error) {
  console.warn('Firebase Admin not initialized; share endpoints disabled.', error);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.join(__dirname, '..', 'dist');

app.use(express.static(clientDistPath));
app.use(express.json({ limit: '25mb' }));

app.post('/api/chat', async (req, res) => {
  try {
    const { message, profile, history } = req.body as { message: string; profile: Profile | null; history: Message[] };

    // --- SMART ROUTER: Producer Workflow ---
    // Only trigger Lyria if the user explicitly asks to produce/generate the final audio
    const triggerKeywords = ['generate the audio', 'produce the track', 'generate the song now', 'create the mp3', 'generate the clip now'];
    const isExecutionRequest = triggerKeywords.some(kw => message.toLowerCase().includes(kw));

    if (isExecutionRequest) {
      const isClip = message.toLowerCase().includes('clip') || message.toLowerCase().includes('30 second');
      const modelId = isClip ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
      
      console.log(`[Router] Handing off to ${modelId} for final generation...`);

      const result = await ai.models.generateContent({
        model: modelId,
        contents: [{
          role: 'user',
          parts: [{ 
            text: `Final Production Request: ${message}. 
            Context: ${profile?.skillLevel} ${profile?.instrument} player. 
            Please generate the high-fidelity 44.1kHz audio track now based on our previous planning.` 
          }]
        }]
      });

      let audioBase64 = "";
      let textContent = "";

      const parts = result.candidates?.[0]?.content?.parts;
      if (parts) {
        for (const part of parts) {
          const text = part.text;
          if (typeof text === 'string') {
            textContent += text;
          }
          const data = part.inlineData?.data;
          if (typeof data === 'string') {
            audioBase64 = data;
          }
        }
      }

      // Produce the lyric & chord sheet for the generated track so it can be
      // shown in the chat, saved to the user's library, and shared.
      let lyricsSheet = "";
      try {
        const planningContext = history
          .filter((m: Message) => m.content)
          .slice(-20)
          .map((m: Message) => `${m.role === 'user' ? 'Musician' : 'Producer'}: ${m.content}`)
          .join('\n\n');

        const sheetResult = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: [{
            role: 'user',
            parts: [{
              text: `Here is the songwriting session that led to a final produced track:\n\n${planningContext}\n\nFinal production request: ${message}\n\nWrite the definitive lyric & chord sheet for this song in Markdown. Requirements:\n- Start with a "# " heading containing the song title.\n- Include key, tempo (BPM), and time signature on one line.\n- Notate chords inline above or within the lyrics using bracket notation, e.g. [G], [Em7], [D/F#].\n- Label every section ([Verse 1], [Chorus], [Bridge], etc.).\n- If the session did not define lyrics (instrumental), provide the chord chart and section structure instead.\n- Output ONLY the sheet itself, no commentary.`
            }]
          }]
        });
        lyricsSheet = sheetResult.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
      } catch (sheetError) {
        console.error('Failed to generate lyric sheet:', sheetError);
      }

      return res.json({
        content: textContent || "Your track has been produced! Listen or download below.",
        audioData: audioBase64,
        lyricsSheet
      });
    }

    // --- CONVERSATIONAL PATH: Gemini 3.1 Pro (The Producer) ---
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
    res.status(500).json({ error: { message: error.message || 'An error occurred' } });
  }
});

// --- Public sharing ---
// Content is written with the Admin SDK (bypasses security rules), and read
// back only through these endpoints, so no public Firestore/Storage access
// is ever granted. Share IDs are unguessable Firestore auto-IDs.

const SHARE_TYPES: SavedItemType[] = ['lesson-plan', 'song', 'audio'];
const MAX_SHARE_CONTENT_CHARS = 200_000;
const MAX_SHARE_AUDIO_BASE64_CHARS = 20_000_000; // ~15 MB of audio

app.post('/api/share', async (req, res) => {
  try {
    if (!adminApp) {
      return res.status(503).json({ error: { message: 'Sharing is not configured on this server.' } });
    }

    const { type, title, content, audioData } = req.body as {
      type: SavedItemType; title: string; content: string; audioData?: string;
    };

    if (!SHARE_TYPES.includes(type) || typeof title !== 'string' || typeof content !== 'string') {
      return res.status(400).json({ error: { message: 'Invalid share payload.' } });
    }
    if (content.length > MAX_SHARE_CONTENT_CHARS || (audioData && audioData.length > MAX_SHARE_AUDIO_BASE64_CHARS)) {
      return res.status(413).json({ error: { message: 'Shared content is too large.' } });
    }

    const db = getAdminFirestore(adminApp);
    const docRef = db.collection('shares').doc();

    let hasAudio = false;
    if (audioData) {
      const bucket = getAdminStorage(adminApp).bucket();
      await bucket.file(`shares/${docRef.id}.mp3`).save(Buffer.from(audioData, 'base64'), {
        contentType: 'audio/mp3',
      });
      hasAudio = true;
    }

    await docRef.set({
      type,
      title: title.slice(0, 200),
      content,
      hasAudio,
      createdAt: Date.now(),
    });

    res.json({ id: docRef.id, path: `/share/${docRef.id}` });
  } catch (error: any) {
    console.error('Error in POST /api/share:', error);
    res.status(500).json({ error: { message: error.message || 'Failed to create share link.' } });
  }
});

app.get('/api/share/:id', async (req, res) => {
  try {
    if (!adminApp) {
      return res.status(503).json({ error: { message: 'Sharing is not configured on this server.' } });
    }
    const snapshot = await getAdminFirestore(adminApp).collection('shares').doc(req.params.id).get();
    if (!snapshot.exists) {
      return res.status(404).json({ error: { message: 'This shared link does not exist.' } });
    }
    const { type, title, content, hasAudio, createdAt } = snapshot.data() as any;
    res.json({ id: snapshot.id, type, title, content, hasAudio: !!hasAudio, createdAt });
  } catch (error: any) {
    console.error('Error in GET /api/share/:id:', error);
    res.status(500).json({ error: { message: error.message || 'Failed to load shared content.' } });
  }
});

app.get('/api/share/:id/audio', async (req, res) => {
  try {
    if (!adminApp) {
      return res.status(503).json({ error: { message: 'Sharing is not configured on this server.' } });
    }
    const file = getAdminStorage(adminApp).bucket().file(`shares/${req.params.id}.mp3`);
    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: { message: 'Audio not found for this share.' } });
    }
    res.setHeader('Content-Type', 'audio/mp3');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    file.createReadStream()
      .on('error', (streamError) => {
        console.error('Error streaming shared audio:', streamError);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      })
      .pipe(res);
  } catch (error: any) {
    console.error('Error in GET /api/share/:id/audio:', error);
    res.status(500).json({ error: { message: error.message || 'Failed to load shared audio.' } });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
