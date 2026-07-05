# AI Musician Buddy

This is a conversational AI companion for musicians, powered by the Google Gemini API. It provides personalized lesson plans, songwriting assistance, technique feedback, and motivational support to help users achieve their musical goals.

This application is built with a secure, scalable architecture designed for production deployment on Google Cloud.

## Core Features

*   **Personalized Lesson Plans:** Generates weekly lesson plans with clear objectives and exercises based on the user's instrument and skill level.
*   **Songwriting Assistance:** Helps users craft original songs by suggesting lyrics, melodies, and rhythm patterns from a simple description.
*   **Technique Critique:** Provides constructive feedback on musical techniques, song structure, and notation.
*   **Motivational Support:** Acts as a supportive coach and jam buddy, providing encouragement in a user-defined tone.
*   **Voice Interaction & Hands-Free Mode:** Speech-to-text is powered by Gemini STT (tap the mic, talk, and it stops automatically when you pause), and every reply can be read aloud with Gemini Flash TTS. Toggle the headphones icon for full hands-free jamming: speak, get a spoken reply, and the mic re-opens automatically.
*   **User Accounts:** Sign in with Google or Email + Password (via Firebase Authentication). Apple sign-in is built but hidden until an Apple Developer account is configured.
*   **Personal Library:** Save generated lesson plans, songs, and audio clips to your profile, then browse, play, re-download, or delete them from any device. Lesson plans and songs can also be downloaded as Markdown files.
*   **Lyric & Chord Sheets:** Every song written in chat is notated with chords inline, and every generated audio track comes with its own lyric & chord sheet that can be downloaded or saved.
*   **Sharing:** One click creates a public link (e.g. `/share/abc123`) for any lesson plan, song sheet, or audio track. The share page plays the audio and displays the sheet — shared songs always include their lyrics + chords.
*   **Jam Mode:** Hit "Jam Now" for an endless, steerable live backing track powered by Lyria RealTime. Blend up to 10 weighted prompts from the Instruments and Music Styles pickers with MusicFX-DJ-style sliders and per-prompt volume nudges, shape the sound with Density/Brightness/Chaos, set BPM and key (with smooth, gapless transitions), save your favorite mixes to reuse, jam over a song from your library with its chord sheet on screen, follow a beat-synced play-along sheet, and share a link to the last minute of your jam. Guests can jam 5 minutes per session; signed-in users get 30.

## Tech Stack

*   **Frontend:** React, TypeScript, Tailwind CSS
*   **Backend:** Node.js, Express
*   **AI:** Gemini via Vertex AI (chat, TTS, STT) and Lyria 3 via the Gemini Interactions API — all authenticated as the Google Cloud service account, no API keys
*   **Accounts & Storage:** Firebase Authentication, Cloud Firestore, Firebase Storage
*   **Deployment:** Docker, Google Cloud Run, Cloud Build

## Deployment

This application is configured for continuous deployment to Google Cloud Run. Pushing a new commit to the `main` branch will automatically trigger a new build and deployment.

## Running Locally

To run this project on your local machine for development:

1.  Clone the repository.
2.  Install the dependencies:
    ```bash
    npm install
    ```
3.  Authenticate for the AI backends. Chat, TTS, and STT use Vertex AI with
    Application Default Credentials:
    ```bash
    gcloud auth application-default login
    ```
    Then create a `.env` file in the root of the project (see `.env.example`).
    A `GEMINI_API_KEY` is only needed for Lyria audio generation; everything
    else works without it. See [AUTH_SETUP.md](./AUTH_SETUP.md) for the Firebase
    (`VITE_FIREBASE_*`) sign-in configuration.
4.  In one terminal, run the backend server:
    ```bash
    npm run build:server && node dist-server/server.js
    ```
5.  In a second terminal, run the frontend development server:
    ```bash
    npm run dev
    ```
6.  Open your browser to `http://localhost:3000`.