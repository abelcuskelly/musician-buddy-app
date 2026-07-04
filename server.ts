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

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'api-connector-mcp';
const FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || process.env.VITE_FIREBASE_STORAGE_BUCKET || 'api-connector-mcp.firebasestorage.app';

// --- Gemini via Vertex AI (service-account auth) ---
// Chat, TTS, and STT authenticate as the service account via Application
// Default Credentials — the Cloud Run service account in production, or
// `gcloud auth application-default login` locally. No API keys involved.
const VERTEX_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || FIREBASE_PROJECT_ID;
const VERTEX_LOCATION = process.env.VERTEX_LOCATION || 'global';

const ai = new GoogleGenAI({ vertexai: true, project: VERTEX_PROJECT, location: VERTEX_LOCATION });

// --- Lyria (audio generation) via the Gemini Developer API ---
// Lyria models are not served on Vertex AI, so this is the one call that still
// needs an API key. In production the key is injected from Secret Manager
// (musician-buddy-api-key), never stored as a plaintext env var.
const LYRIA_API_KEY = process.env.GEMINI_API_KEY;
const lyriaAI = LYRIA_API_KEY ? new GoogleGenAI({ apiKey: LYRIA_API_KEY, vertexai: false }) : null;
if (!lyriaAI) {
  console.warn('GEMINI_API_KEY not set: Lyria audio generation is disabled (chat/TTS/STT unaffected).');
}

// Voice models (overridable via env without a code change).
// Model IDs verified against the Vertex AI global endpoint for this project.
const TTS_MODEL = process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const TTS_VOICE = process.env.GEMINI_TTS_VOICE || 'Kore';
const STT_MODEL = process.env.GEMINI_STT_MODEL || 'gemini-3-flash-preview';
const STT_FALLBACK_MODEL = 'gemini-3.1-pro-preview';

// --- Firebase Admin (used for the public share feature) ---

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
      if (!lyriaAI) {
        return res.json({
          content: "Audio generation isn't configured on this server right now (missing Lyria credentials), but I'm happy to keep refining the song plan with you!",
        });
      }

      const isClip = message.toLowerCase().includes('clip') || message.toLowerCase().includes('30 second');
      const modelId = isClip ? "lyria-3-clip-preview" : "lyria-3-pro-preview";
      
      console.log(`[Router] Handing off to ${modelId} for final generation...`);

      const result = await lyriaAI.models.generateContent({
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

// --- Voice: Text-to-Speech and Speech-to-Text (Gemini via Vertex AI) ---

/** Wraps raw 16-bit PCM in a WAV container so browsers can play it directly. */
const pcmToWav = (pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer => {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

const MAX_TTS_CHARS = 5000;

app.post('/api/tts', async (req, res) => {
  try {
    const { text, voice } = req.body as { text: string; voice?: string };
    if (typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: { message: 'No text provided for speech.' } });
    }

    const result = await ai.models.generateContent({
      model: TTS_MODEL,
      contents: [{ role: 'user', parts: [{ text: text.slice(0, MAX_TTS_CHARS) }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || TTS_VOICE } },
        },
      },
    });

    const audioPart = result.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
    const data = audioPart?.inlineData?.data;
    const mimeType = audioPart?.inlineData?.mimeType || '';
    if (!data) {
      return res.status(502).json({ error: { message: 'The TTS model returned no audio.' } });
    }

    // Gemini TTS returns raw PCM (e.g. audio/L16;rate=24000); wrap it as WAV.
    if (/audio\/(L16|pcm)/i.test(mimeType)) {
      const rate = parseInt(mimeType.match(/rate=(\d+)/)?.[1] ?? '24000', 10);
      const wav = pcmToWav(Buffer.from(data, 'base64'), rate);
      return res.json({ audioData: wav.toString('base64'), mimeType: 'audio/wav' });
    }
    return res.json({ audioData: data, mimeType });
  } catch (error: any) {
    console.error('Error in /api/tts:', error);
    res.status(500).json({ error: { message: error.message || 'Text-to-speech failed.' } });
  }
});

const MAX_STT_AUDIO_BASE64_CHARS = 15_000_000; // ~11 MB of audio

app.post('/api/stt', async (req, res) => {
  try {
    const { audioData, mimeType } = req.body as { audioData: string; mimeType: string };
    if (typeof audioData !== 'string' || !audioData || !/^audio\//.test(mimeType || '')) {
      return res.status(400).json({ error: { message: 'No audio provided for transcription.' } });
    }
    if (audioData.length > MAX_STT_AUDIO_BASE64_CHARS) {
      return res.status(413).json({ error: { message: 'Audio recording is too long.' } });
    }

    const transcribeWith = (model: string) => ai.models.generateContent({
      model,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: audioData } },
          { text: 'Transcribe the speech in this audio recording verbatim, with natural punctuation. Output ONLY the transcribed text — no labels, no commentary. If there is no intelligible speech, output nothing.' },
        ],
      }],
    });

    let result;
    try {
      result = await transcribeWith(STT_MODEL);
    } catch (modelError: any) {
      // Fall back to the pro model if the flash STT model isn't available in this region.
      if (/not found|NOT_FOUND|does not exist|404/i.test(modelError.message || '')) {
        console.warn(`STT model ${STT_MODEL} unavailable, falling back to ${STT_FALLBACK_MODEL}`);
        result = await transcribeWith(STT_FALLBACK_MODEL);
      } else {
        throw modelError;
      }
    }

    const transcript = (result.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '').trim();
    res.json({ transcript });
  } catch (error: any) {
    console.error('Error in /api/stt:', error);
    res.status(500).json({ error: { message: error.message || 'Speech-to-text failed.' } });
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
