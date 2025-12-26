# AI Musician Buddy

This is a conversational AI companion for musicians, powered by the Google Gemini API. It provides personalized lesson plans, songwriting assistance, technique feedback, and motivational support to help users achieve their musical goals.

This application is built with a secure, scalable architecture designed for production deployment on Google Cloud.

## Core Features

*   **Personalized Lesson Plans:** Generates weekly lesson plans with clear objectives and exercises based on the user's instrument and skill level.
*   **Songwriting Assistance:** Helps users craft original songs by suggesting lyrics, melodies, and rhythm patterns from a simple description.
*   **Technique Critique:** Provides constructive feedback on musical techniques, song structure, and notation.
*   **Motivational Support:** Acts as a supportive coach and jam buddy, providing encouragement in a user-defined tone.
*   **Voice Interaction:** Includes a voice-to-text feature for hands-free interaction.

## Tech Stack

*   **Frontend:** React, TypeScript, Tailwind CSS
*   **Backend:** Node.js, Express
*   **AI:** Google Gemini API
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
3.  Create a `.env` file in the root of the project and add your API key:
    ```
    API_KEY=your_gemini_api_key_here
    ```
4.  In one terminal, run the backend server:
    ```bash
    npm run build:server && node dist-server/server.js
    ```
5.  In a second terminal, run the frontend development server:
    ```bash
    npm run dev
    ```
6.  Open your browser to `http://localhost:3000`.