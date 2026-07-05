import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, Chat, Content, LiveMusicSession } from '@google/genai';
import { GoogleAuth, Impersonated } from 'google-auth-library';
import { initializeApp as initializeAdminApp, getApps as getAdminApps, App as AdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { getStorage as getAdminStorage } from 'firebase-admin/storage';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
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

// --- Lyria 3 via the Interactions API (service-account auth, no API keys) ---
// https://ai.google.dev/gemini-api/docs/music-generation
// Lyria is served by the Gemini Interactions API, which accepts OAuth tokens
// carrying the generative-language scope. On Cloud Run the service account
// mints these directly from the metadata server; for local development (where
// ADC is a user credential that can't carry that scope) we impersonate the
// same service account.
const LYRIA_SCOPE = 'https://www.googleapis.com/auth/generative-language';
const LYRIA_SERVICE_ACCOUNT = process.env.LYRIA_SERVICE_ACCOUNT || '243585371458-compute@developer.gserviceaccount.com';
const INTERACTIONS_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';

const lyriaAuth = new GoogleAuth({ scopes: [LYRIA_SCOPE] });

const getLyriaAccessToken = async (): Promise<string> => {
  const client = await lyriaAuth.getClient();
  // Service-account credentials (Cloud Run / GCE metadata) honor the requested
  // scope directly. User ADC needs to impersonate the service account instead.
  const isUserCredential = client.constructor.name === 'UserRefreshClient';
  const tokenClient = isUserCredential
    ? new Impersonated({
        sourceClient: client,
        targetPrincipal: LYRIA_SERVICE_ACCOUNT,
        targetScopes: [LYRIA_SCOPE],
        lifetime: 3600,
        delegates: [],
      })
    : client;
  const { token } = await tokenClient.getAccessToken();
  if (!token) throw new Error('Failed to obtain an access token for Lyria.');
  return token;
};

interface LyriaOutput {
  audioBase64: string;
  lyrics: string;
}

// Matches the various shapes Google's safety filters use when rejecting a
// music prompt (error codes, enum strings, and prose variants).
const POLICY_BLOCK_PATTERN = /content_blocked|PROHIBITED_CONTENT|blocked for .*policy|safety|blocklist|prohibited/i;

/** Calls a Lyria 3 model through the Interactions API and parses the steps. */
const generateLyriaMusic = async (model: string, input: string): Promise<LyriaOutput> => {
  const token = await getLyriaAccessToken();
  const response = await fetch(INTERACTIONS_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });

  const interaction: any = await response.json();
  if (!response.ok) {
    const message = interaction?.error?.message || `Lyria request failed (HTTP ${response.status}).`;
    const code = String(interaction?.error?.code ?? '');
    const error: any = new Error(message);
    error.contentBlocked = POLICY_BLOCK_PATTERN.test(code) || POLICY_BLOCK_PATTERN.test(message);
    throw error;
  }

  // Interactions return a sequence of steps; model_output steps hold content
  // blocks of type "audio" (base64 MP3) and "text" (lyrics / song structure).
  let audioBase64 = '';
  const lyricsParts: string[] = [];
  for (const step of interaction.steps ?? []) {
    if (step.type !== 'model_output') continue;
    for (const block of step.content ?? []) {
      if (block.type === 'audio' && block.data) {
        audioBase64 = block.data;
      } else if (block.type === 'text' && block.text) {
        lyricsParts.push(block.text);
      }
    }
  }

  // A 200 with no audio means generation was silently filtered — surface it
  // as a block instead of returning an empty "success" to the UI.
  if (!audioBase64) {
    const error: any = new Error(`Lyria returned no audio (status: ${interaction?.status ?? 'unknown'}).`);
    error.contentBlocked = true;
    throw error;
  }

  return { audioBase64, lyrics: lyricsParts.join('\n').trim() };
};

interface PromptScreenResult {
  verdict: 'ok' | 'rewritten' | 'blocked';
  input: string; // the (possibly rewritten) prompt that is safe to send
  reason?: string; // user-facing explanation for a rewrite or block
}

/**
 * Light pre-filter run before every Lyria call. Google's music models reject
 * prompts naming real artists/public figures, requesting copyrighted lyrics,
 * or touching prohibited themes (hate, sexual content, violence, self-harm,
 * illegal activity, PII). A fast Gemini pass rewrites artist references into
 * neutral style descriptors and blocks clearly prohibited requests, so most
 * generations succeed instead of dying at Google's filter. Fails open: if
 * screening errors out, the original prompt is sent unchanged.
 */
const screenLyriaPrompt = async (input: string): Promise<PromptScreenResult> => {
  try {
    const result = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      config: { responseMimeType: 'application/json' },
      contents: [{
        role: 'user',
        parts: [{
          text: `You are a music-generation prompt screener. The prompt below will be sent to a music AI (Lyria) whose safety policy REJECTS: (1) real artist/band/public-figure names or "in the style of <artist>" requests, (2) reproduction of copyrighted lyrics, (3) hate/harassment, sexually explicit content, violence or dangerous activities, self-harm, illegal activity, or personal identifying information.

Analyze the prompt and respond with ONLY a JSON object:
- If it has none of these issues: {"verdict":"ok"}
- If it names artists/bands/public figures or copyrighted songs: rewrite it, replacing each name with concrete musical descriptors of that sound (genre, era, vocal character, instrumentation, production style) and removing any copyrighted lyric lines. Keep everything else (BPM, key, structure, original lyrics) EXACTLY intact. Respond: {"verdict":"rewritten","input":"<full rewritten prompt>","reason":"<one short sentence, e.g. replaced the artist name with a style description>"}
- Only if it clearly requests prohibited themes that cannot be fixed by rewriting: {"verdict":"blocked","reason":"<one short user-facing sentence naming the problematic theme>"}

PROMPT:
${input}`
        }]
      }]
    });

    const raw = result.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
    const parsed = JSON.parse(raw);
    if (parsed.verdict === 'rewritten' && typeof parsed.input === 'string' && parsed.input.trim()) {
      return { verdict: 'rewritten', input: parsed.input, reason: parsed.reason };
    }
    if (parsed.verdict === 'blocked') {
      return { verdict: 'blocked', input, reason: parsed.reason };
    }
    return { verdict: 'ok', input };
  } catch (error) {
    console.warn('Prompt screening failed; sending original prompt:', error);
    return { verdict: 'ok', input };
  }
};

const POLICY_BLOCK_USER_MESSAGE = `**I couldn't generate that track — the request was blocked by Google's music content policy (PROHIBITED_CONTENT).**

This usually happens when a prompt includes:
- A **real artist, band, or public figure's name** (e.g. "sounds like <artist>") — the music model can't imitate specific artists
- **Copyrighted lyrics** from an existing song
- Sensitive themes (violence, explicit content, hate speech, self-harm, illegal activity, or personal information)

**The fix:** describe the *sound* instead of naming names — for example "upbeat 2010s pop with bright female vocals, acoustic guitar, and punchy drums at 120 BPM." Update the concept or lyrics and say **"generate the audio now"** to try again!`;

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

// Cloud Run sits behind one proxy hop; trust it so rate limiting sees the
// real client IP from X-Forwarded-For.
app.set('trust proxy', 1);

// General limit for static assets and pages.
app.use(rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
}));

// Tighter limit for API routes, which invoke AI models and cloud storage.
app.use('/api', rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Too many requests — please slow down and try again in a minute.' } },
}));

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

      // Build a rich Lyria prompt from the planning session (Lyria is
      // single-turn, so the musical direction must all be in one input).
      const planningContext = history
        .filter((m: Message) => m.content)
        .slice(-20)
        .map((m: Message) => `${m.role === 'user' ? 'Musician' : 'Producer'}: ${m.content}`)
        .join('\n\n');

      const lyriaInput = `${message}

Musical direction from our production session (genre, instruments, BPM, key, structure, and lyrics to follow):
${planningContext || `A piece suited to a ${profile?.skillLevel ?? 'beginner'} ${profile?.instrument ?? 'guitar'} player who loves ${profile?.musicGenres ?? 'popular'} music.`}`;

      // Pre-screen the prompt: rewrite artist-name references into style
      // descriptors and stop clearly prohibited requests before they reach
      // (and get hard-blocked by) Google's Lyria safety filters.
      const screened = await screenLyriaPrompt(lyriaInput);
      if (screened.verdict === 'blocked') {
        return res.json({
          content: `**I can't send that one to the music generator** — ${screened.reason || 'it includes a theme that Google\'s music content policy prohibits'} (Google blocks music prompts involving sensitive subjects, explicit content, or real people's identities).\n\nLet's rework the concept or lyrics together, then say **"generate the audio now"** to try again!`,
        });
      }
      if (screened.verdict === 'rewritten') {
        console.log(`[Screen] Lyria prompt rewritten: ${screened.reason}`);
      }

      let lyriaResult: LyriaOutput;
      try {
        lyriaResult = await generateLyriaMusic(modelId, screened.input);
      } catch (lyriaError: any) {
        console.error('Lyria generation failed:', lyriaError);
        return res.json({
          content: lyriaError.contentBlocked
            ? POLICY_BLOCK_USER_MESSAGE
            : "**I hit a technical snag producing the track** (the music service didn't respond as expected — this isn't a problem with your song). Say **\"generate the audio now\"** to try again in a moment!",
        });
      }

      // Turn Lyria's own generated lyrics/structure into a polished lyric &
      // chord sheet for the chat, the user's library, and sharing.
      let lyricsSheet = "";
      try {
        const sheetResult = await ai.models.generateContent({
          model: 'gemini-3.1-pro-preview',
          contents: [{
            role: 'user',
            parts: [{
              text: `A music model just produced a track. ${lyriaResult.lyrics ? `Here are the exact lyrics and song structure it generated:\n\n${lyriaResult.lyrics}` : 'It is an instrumental piece with no lyrics.'}\n\nHere is the songwriting session that led to it:\n\n${planningContext}\n\nWrite the definitive lyric & chord sheet for this song in Markdown. Requirements:\n- Use the generated lyrics EXACTLY as provided (do not rewrite them); add chord notation around them.\n- Start with a "# " heading containing the song title.\n- Include key, tempo (BPM), and time signature on one line.\n- Notate chords inline with the lyrics using bracket notation, e.g. [G], [Em7], [D/F#].\n- Label every section ([Verse 1], [Chorus], [Bridge], etc.).\n- If instrumental, provide the chord chart and section structure instead.\n- Output ONLY the sheet itself, no commentary.`
            }]
          }]
        });
        lyricsSheet = sheetResult.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
      } catch (sheetError) {
        console.error('Failed to generate lyric sheet:', sheetError);
        lyricsSheet = lyriaResult.lyrics; // fall back to Lyria's raw lyrics
      }

      const rewriteNote = screened.verdict === 'rewritten'
        ? `\n\n*Heads up: Google's music policy doesn't allow real artist names in prompts, so I ${screened.reason?.replace(/\.$/, '') || 'rephrased that reference as a style description'} before generating.*`
        : '';

      return res.json({
        content: `Your track has been produced! Listen or download below.${rewriteNote}`,
        audioData: lyriaResult.audioBase64,
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

// --- Jam Mode helpers ---

const JAM_SCALE_ENUMS = [
  'C_MAJOR_A_MINOR', 'D_FLAT_MAJOR_B_FLAT_MINOR', 'D_MAJOR_B_MINOR', 'E_FLAT_MAJOR_C_MINOR',
  'E_MAJOR_D_FLAT_MINOR', 'F_MAJOR_D_MINOR', 'G_FLAT_MAJOR_E_FLAT_MINOR', 'G_MAJOR_E_MINOR',
  'A_FLAT_MAJOR_F_MINOR', 'A_MAJOR_G_FLAT_MINOR', 'B_FLAT_MAJOR_G_MINOR', 'B_MAJOR_A_FLAT_MINOR',
];

// Derives Lyria RealTime jam settings (weighted style prompts, BPM, key) from
// a previously written song sheet, so users can jam over their own songs.
app.post('/api/jam/seed', async (req, res) => {
  try {
    const { title, content } = req.body as { title: string; content: string };
    if (typeof content !== 'string' || !content.trim()) {
      return res.status(400).json({ error: { message: 'No song content provided.' } });
    }

    const result = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      config: { responseMimeType: 'application/json' },
      contents: [{
        role: 'user',
        parts: [{
          text: `Here is a song sheet titled "${(title || 'Untitled').slice(0, 100)}":\n\n${content.slice(0, 8000)}\n\nA real-time instrumental music generator will play a backing track for this song. It accepts 3-5 short weighted text prompts (instruments, genres, moods — NEVER artist names), a BPM (60-200), and a musical scale.\n\nRespond with ONLY a JSON object:\n{"prompts":[{"text":"<descriptor>","weight":<0.5-1.5>}...],"bpm":<number or null>,"scale":"<one of: ${JAM_SCALE_ENUMS.join(', ')} — or null if unclear>"}\n\nUse the sheet's stated key/tempo when present; otherwise infer from the style. Prompts should recreate the song's vibe and instrumentation.`
        }]
      }]
    });

    const raw = result.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '{}';
    const parsed = JSON.parse(raw);
    const prompts = (Array.isArray(parsed.prompts) ? parsed.prompts : [])
      .filter((p: any) => typeof p.text === 'string' && p.text.trim())
      .slice(0, 5)
      .map((p: any) => ({
        text: p.text.trim().slice(0, 60),
        weight: Math.min(Math.max(typeof p.weight === 'number' ? p.weight : 1, 0.3), 2),
      }));
    if (prompts.length === 0) {
      return res.status(422).json({ error: { message: "Couldn't derive jam settings from that song. Try another one!" } });
    }

    res.json({
      prompts,
      bpm: typeof parsed.bpm === 'number' ? Math.round(Math.min(Math.max(parsed.bpm, 60), 200)) : null,
      scale: JAM_SCALE_ENUMS.includes(parsed.scale) ? parsed.scale : null,
    });
  } catch (error: any) {
    console.error('Error in /api/jam/seed:', error);
    res.status(500).json({ error: { message: error.message || 'Failed to derive jam settings.' } });
  }
});

// Generates a simple play-along chord sheet matching the current jam settings
// (used when the jam wasn't seeded from an existing song).
app.post('/api/jam/sheet', async (req, res) => {
  try {
    const { prompts, bpm, scale } = req.body as { prompts: { text: string; weight: number }[]; bpm?: number; scale?: string };
    const promptList = (Array.isArray(prompts) ? prompts : [])
      .filter(p => typeof p.text === 'string')
      .slice(0, 10)
      .map(p => p.text.slice(0, 60))
      .join(', ');

    const result = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: [{
        role: 'user',
        parts: [{
          text: `A musician is jamming over a live generated instrumental with this vibe: ${promptList || 'freeform jam'}.${bpm ? ` Tempo: ${bpm} BPM.` : ''}${scale ? ` Scale: ${scale.replace(/_/g, ' ').toLowerCase()}.` : ''}\n\nWrite a simple play-along chord sheet in Markdown they can follow:\n- Start with a "# " heading (a short evocative jam title).\n- One line: Key, BPM (use the given values; pick sensible ones if missing), time signature 4/4.\n- 2-3 short sections labeled [Section A], [Section B], etc.\n- In each section, write 2-4 lines of chord progressions using bracket notation with one chord per bar, e.g. "[G]  [C]  [Em]  [D]". Use 4 chords per line.\n- Keep chords diatonic to the key and easy to play.\n- Output ONLY the sheet, no commentary.`
        }]
      }]
    });

    const sheet = result.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join('') ?? '';
    if (!sheet.trim()) {
      return res.status(502).json({ error: { message: 'Could not generate a chord sheet right now.' } });
    }
    res.json({ sheet });
  } catch (error: any) {
    console.error('Error in /api/jam/sheet:', error);
    res.status(500).json({ error: { message: error.message || 'Failed to generate the chord sheet.' } });
  }
});

// --- Public sharing ---
// Content is written with the Admin SDK (bypasses security rules), and read
// back only through these endpoints, so no public Firestore/Storage access
// is ever granted. Share IDs are unguessable Firestore auto-IDs.

const SHARE_TYPES: SavedItemType[] = ['lesson-plan', 'song', 'audio'];
const MAX_SHARE_CONTENT_CHARS = 200_000;
const MAX_SHARE_AUDIO_BASE64_CHARS = 20_000_000; // ~15 MB of audio

interface CreateShareParams {
  type: SavedItemType;
  title: string;
  content: string;
  audioBuffer?: Buffer;
  audioMimeType?: string;
}

/** Stores a public share (Firestore doc + optional audio file) and returns its path. */
const createShareRecord = async ({ type, title, content, audioBuffer, audioMimeType }: CreateShareParams): Promise<{ id: string; path: string }> => {
  if (!adminApp) {
    throw new Error('Sharing is not configured on this server.');
  }
  const db = getAdminFirestore(adminApp);
  const docRef = db.collection('shares').doc();

  let hasAudio = false;
  if (audioBuffer) {
    const bucket = getAdminStorage(adminApp).bucket();
    await bucket.file(`shares/${docRef.id}.mp3`).save(audioBuffer, {
      contentType: audioMimeType || 'audio/mp3',
    });
    hasAudio = true;
  }

  await docRef.set({
    type,
    title: title.slice(0, 200),
    content,
    hasAudio,
    ...(hasAudio ? { audioMimeType: audioMimeType || 'audio/mp3' } : {}),
    createdAt: Date.now(),
  });

  return { id: docRef.id, path: `/share/${docRef.id}` };
};

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

    const share = await createShareRecord({
      type,
      title,
      content,
      audioBuffer: audioData ? Buffer.from(audioData, 'base64') : undefined,
    });
    res.json(share);
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
    const [metadata] = await file.getMetadata().catch(() => [{ contentType: 'audio/mp3' }] as any);
    res.setHeader('Content-Type', metadata?.contentType || 'audio/mp3');
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

// --- Jam Mode: Lyria RealTime WebSocket proxy ---
// The browser connects to /api/jam; the server holds the Google-side session
// (models/lyria-realtime-exp, v1alpha). The experimental live-music surface
// only accepts API keys (verified: OAuth tokens are rejected), so the key is
// injected from Secret Manager and never leaves the server.
const JAM_API_KEY = process.env.GEMINI_API_KEY;
const JAM_MODEL = process.env.LYRIA_REALTIME_MODEL || 'models/lyria-realtime-exp';
// Cost guards: guests get a 5-minute taste; signed-in users get 30 minutes.
const JAM_GUEST_SESSION_MS = 5 * 60 * 1000;
const JAM_USER_SESSION_MS = 30 * 60 * 1000;
const JAM_GUEST_END_MESSAGE = "You've reached the 5-minute guest jam limit. Create a free account to jam for up to 30 minutes at a time!";
const JAM_USER_END_MESSAGE = 'Jam session reached the 30-minute limit — start a new jam to keep playing!';
const JAM_MAX_CONCURRENT = 8;
const JAM_SAMPLE_RATE = 48000;
const JAM_BYTES_PER_SECOND = JAM_SAMPLE_RATE * 2 /* channels */ * 2 /* bytes */;
const JAM_SHARE_BUFFER_BYTES = 60 * JAM_BYTES_PER_SECOND; // last 60 seconds

let activeJamSessions = 0;

/** Rolling byte buffer holding the most recent N bytes of jam audio. */
class RollingAudioBuffer {
  private chunks: Buffer[] = [];
  private totalBytes = 0;

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.totalBytes += chunk.length;
    while (this.totalBytes > JAM_SHARE_BUFFER_BYTES && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.totalBytes -= removed.length;
    }
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }

  get seconds(): number {
    return this.totalBytes / JAM_BYTES_PER_SECOND;
  }
}

const sendJson = (ws: WebSocket, payload: unknown): void => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
};

const handleJamConnection = async (ws: WebSocket): Promise<void> => {
  if (!JAM_API_KEY) {
    sendJson(ws, { type: 'error', message: 'Jam Mode is not configured on this server (missing Lyria RealTime credentials).' });
    ws.close();
    return;
  }
  if (activeJamSessions >= JAM_MAX_CONCURRENT) {
    sendJson(ws, { type: 'error', message: 'The jam room is full right now — please try again in a few minutes.' });
    ws.close();
    return;
  }

  activeJamSessions++;
  const rolling = new RollingAudioBuffer();
  let lyria: LiveMusicSession | null = null;
  let closed = false;
  // Remember the latest prompts/config for the share description, and because
  // Lyria resets unspecified config fields on every update.
  let lastPrompts: { text: string; weight: number }[] = [];
  let lastConfig: Record<string, unknown> = {};

  const cleanup = (reason?: string, upsell = false) => {
    if (closed) return;
    closed = true;
    activeJamSessions--;
    clearTimeout(sessionTimer);
    clearInterval(keepAlive);
    try { lyria?.stop(); lyria?.close(); } catch { /* already closed */ }
    if (ws.readyState === WebSocket.OPEN) {
      if (reason) sendJson(ws, { type: 'ended', reason, upsell });
      ws.close();
    }
  };

  // Sessions start on the guest clock; a verified sign-in upgrades to the
  // 30-minute limit (see the 'auth' message handler below).
  let isSignedIn = false;
  let sessionTimer = setTimeout(() => cleanup(JAM_GUEST_END_MESSAGE, true), JAM_GUEST_SESSION_MS);

  const keepAlive = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, 30_000);

  try {
    const jamClient = new GoogleGenAI({ apiKey: JAM_API_KEY, apiVersion: 'v1alpha' });
    lyria = await jamClient.live.music.connect({
      model: JAM_MODEL,
      callbacks: {
        onmessage: (message: any) => {
          if (message.setupComplete) {
            sendJson(ws, { type: 'ready' });
          }
          if (message.filteredPrompt) {
            sendJson(ws, {
              type: 'filtered',
              text: message.filteredPrompt.text ?? '',
              reason: message.filteredPrompt.filteredReason ?? 'This prompt was blocked by the music safety filter.',
            });
          }
          const chunks = message.serverContent?.audioChunks;
          if (chunks) {
            for (const chunk of chunks) {
              if (!chunk.data) continue;
              rolling.push(Buffer.from(chunk.data, 'base64'));
              sendJson(ws, { type: 'audio', data: chunk.data });
            }
          }
        },
        onerror: (error: any) => {
          console.error('Lyria RealTime session error:', error?.message || error);
          sendJson(ws, { type: 'error', message: 'The music stream hit an error. Try ending and restarting the jam.' });
        },
        onclose: () => cleanup(),
      },
    });
  } catch (error: any) {
    console.error('Failed to connect to Lyria RealTime:', error);
    sendJson(ws, { type: 'error', message: 'Could not start the live music stream. Please try again shortly.' });
    cleanup();
    return;
  }

  ws.on('message', async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    try {
      switch (msg.type) {
        case 'auth': {
          if (isSignedIn || !adminApp || typeof msg.token !== 'string') break;
          try {
            await getAdminAuth(adminApp).verifyIdToken(msg.token);
            isSignedIn = true;
            clearTimeout(sessionTimer);
            sessionTimer = setTimeout(() => cleanup(JAM_USER_END_MESSAGE), JAM_USER_SESSION_MS);
            sendJson(ws, { type: 'session-limit', minutes: 30 });
          } catch {
            // Invalid/expired token: stay on the guest clock.
          }
          break;
        }
        case 'prompts': {
          const prompts = (Array.isArray(msg.prompts) ? msg.prompts : [])
            .filter((p: any) => typeof p.text === 'string' && p.text.trim() && typeof p.weight === 'number' && p.weight > 0)
            .slice(0, 10)
            .map((p: any) => ({ text: p.text.trim().slice(0, 120), weight: Math.min(Math.max(p.weight, 0.01), 3) }));
          if (prompts.length === 0) break;
          lastPrompts = prompts;
          await lyria!.setWeightedPrompts({ weightedPrompts: prompts });
          break;
        }
        case 'config': {
          const c = msg.config ?? {};
          const config: Record<string, unknown> = {
            temperature: clampNumber(c.temperature, 0, 3, 1.1),
            guidance: clampNumber(c.guidance, 0, 6, 4.0),
            density: c.density === undefined ? undefined : clampNumber(c.density, 0, 1, 0.5),
            brightness: c.brightness === undefined ? undefined : clampNumber(c.brightness, 0, 1, 0.5),
            bpm: c.bpm === undefined ? undefined : Math.round(clampNumber(c.bpm, 60, 200, 120)),
            scale: typeof c.scale === 'string' && c.scale !== 'SCALE_UNSPECIFIED' ? c.scale : undefined,
            muteBass: !!c.muteBass,
            muteDrums: !!c.muteDrums,
            onlyBassAndDrums: !!c.onlyBassAndDrums,
          };
          Object.keys(config).forEach(k => config[k] === undefined && delete config[k]);
          lastConfig = config;
          await lyria!.setMusicGenerationConfig({ musicGenerationConfig: config });
          // BPM and scale changes only take effect after a context reset (hard transition).
          if (msg.reset) lyria!.resetContext();
          break;
        }
        case 'play': lyria!.play(); break;
        case 'pause': lyria!.pause(); break;
        case 'stop': lyria!.stop(); break;
        case 'share': {
          if (rolling.seconds < 3) {
            sendJson(ws, { type: 'share-error', message: 'Not enough audio yet — jam a little longer, then share!' });
            break;
          }
          const wav = pcmToWav(rolling.toBuffer(), JAM_SAMPLE_RATE, 2);
          const promptList = lastPrompts.map(p => `- **${p.text}** (weight ${p.weight.toFixed(1)})`).join('\n') || '- Freeform jam';
          const configBits = [
            lastConfig.bpm ? `BPM: ${lastConfig.bpm}` : null,
            lastConfig.scale ? `Key: ${String(lastConfig.scale).replace(/_/g, ' ').toLowerCase()}` : null,
          ].filter(Boolean).join(' | ');
          const share = await createShareRecord({
            type: 'audio',
            title: `Live Jam — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
            content: `# Live Jam Session\n\nA real-time jam created in Jam Mode with Lyria RealTime. This clip captures the last ${Math.round(rolling.seconds)} seconds of the session.\n\n**The mix:**\n${promptList}${configBits ? `\n\n${configBits}` : ''}`,
            audioBuffer: wav,
            audioMimeType: 'audio/wav',
          });
          sendJson(ws, { type: 'shared', path: share.path });
          break;
        }
      }
    } catch (error: any) {
      console.error(`Jam control error (${msg.type}):`, error);
      sendJson(ws, { type: 'error', message: `Couldn't apply that change (${msg.type}). Please try again.` });
    }
  });

  ws.on('close', () => cleanup());
  ws.on('error', () => cleanup());
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(n, min), max);
};

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const jamWss = new WebSocketServer({ server, path: '/api/jam' });
jamWss.on('connection', (ws) => {
  handleJamConnection(ws).catch((error) => {
    console.error('Jam connection handler failed:', error);
    try { ws.close(); } catch { /* ignore */ }
  });
});
