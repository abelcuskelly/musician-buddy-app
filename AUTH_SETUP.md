# User Accounts & Sharing Setup (Firebase)

The app uses **Firebase Authentication** for sign-in (Google and Email + Password;
Apple is hidden until an Apple Developer account is available), **Cloud Firestore**
for user profiles, saved library items, and shared content, and **Firebase Storage**
for audio files.

## Current status (provisioned July 2026)

Firebase is attached to the existing Google Cloud project **`api-connector-mcp`**
(the same project that runs the Cloud Run service), so no extra billing setup was needed.

| Resource | Value |
| --- | --- |
| Firebase project | `api-connector-mcp` |
| Web app | "Jam Buddy Web" (`1:243585371458:web:bd84887488704900e20cdb`) |
| Firestore | Native mode, `nam5` (US multi-region) |
| Storage bucket | `api-connector-mcp.firebasestorage.app` (us-central1) |
| Email/Password provider | Enabled |
| Google provider | Needs one console toggle (see below) |
| Apple provider | Deferred (needs Apple Developer account) |
| Authorized domains | localhost, firebaseapp.com/web.app defaults, the Cloud Run URL, jambud.co |

The web config values live in `.env` (`VITE_FIREBASE_*`, see `.env.example`) and are
also hardcoded as fallbacks in `lib/firebase.ts` — the Firebase *web* config is public
by design; all access control comes from the security rules and authorized domains.

### Remaining manual step: enable the Google provider

Enabling Google sign-in auto-provisions an OAuth client, which Google does not expose
through any public API — it requires a one-time console step (~30 seconds):

1. Open [Authentication → Sign-in method](https://console.firebase.google.com/project/api-connector-mcp/authentication/providers).
2. Click **Google** → toggle **Enable** → pick a support email → **Save**.

Until then, the "Continue with Google" button will return an
"operation not allowed" error; Email + Password sign-in already works.

### Enabling Apple later

1. Get an [Apple Developer account](https://developer.apple.com/) and create a
   Services ID + private key ([Firebase docs](https://firebase.google.com/docs/auth/web/apple)).
2. Enable the Apple provider in the Firebase Console with those values.
3. Flip `APPLE_SIGN_IN_ENABLED` to `true` in `components/AuthModal.tsx`.

## Security rules

Rules are version-controlled in this repo — `firestore.rules` and `storage.rules` —
and were deployed via the Firebase Rules API. Summary:

- `users/{uid}` and `users/{uid}/library/**`: readable/writable only by that signed-in user.
- Everything else (including `shares/**`): **no client access**. Shared content is
  written and read exclusively by the backend using the Admin SDK.

To redeploy rules after editing, use the Firebase CLI (`firebase deploy --only firestore:rules,storage`)
or the Rules REST API.

## Sharing architecture

- `POST /api/share` — the server stores `{ type, title, content, hasAudio, createdAt }`
  in Firestore `shares/{id}` and uploads audio (if any) to Storage at `shares/{id}.mp3`.
  Shared audio always includes the lyric & chord sheet as its content.
- `GET /api/share/:id` — returns the shared content as JSON.
- `GET /api/share/:id/audio` — streams the MP3 (the bucket is never public).
- `GET /share/:id` — the React app renders the public share page.

Share IDs are unguessable Firestore auto-IDs. The server authenticates to Firebase
with Application Default Credentials: the service account on Cloud Run, or
`gcloud auth application-default login` locally.

## Data model

```
users/{uid}                     -> { profile, email, displayName, updatedAt }
users/{uid}/library/{itemId}    -> { type: 'lesson-plan' | 'song' | 'audio',
                                     title, content, audioUrl?, audioPath?, createdAt }
shares/{shareId}                -> { type, title, content, hasAudio, createdAt }
Storage: users/{uid}/audio/{itemId}.mp3   (private, per-user)
Storage: shares/{shareId}.mp3             (served only via the backend)
```

## Local development

`.env` in the repo root (gitignored) holds `GEMINI_API_KEY` and the `VITE_FIREBASE_*`
values; the server loads it automatically via `process.loadEnvFile()`. For the share
endpoints to work locally you also need ADC: `gcloud auth application-default login`.
