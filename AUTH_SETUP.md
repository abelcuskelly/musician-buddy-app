# User Accounts Setup (Firebase)

The app uses **Firebase Authentication** for sign-in (Google, Apple, and Email + Password),
**Cloud Firestore** for storing user profiles and saved lesson plans / songs, and
**Firebase Storage** for saved audio clips.

Until Firebase is configured, the app still works fully for chat and downloads — the
Sign In button simply shows a "not configured" notice.

## 1. Create a Firebase project

1. Go to the [Firebase Console](https://console.firebase.google.com/) and click **Add project**.
   - Tip: you can attach Firebase to the *same* Google Cloud project that runs the app on Cloud Run.
2. In the project, click the **Web** icon (`</>`) to register a web app.
3. Copy the config values shown (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).

## 2. Enable sign-in providers

In **Build → Authentication → Sign-in method**, enable:

| Provider | Notes |
| --- | --- |
| **Email/Password** | Just toggle it on. |
| **Google** | Toggle on and pick a support email. |
| **Apple** | Requires an [Apple Developer account](https://developer.apple.com/). Create a Services ID + private key in the Apple Developer portal and paste them into the Firebase provider form ([Firebase docs](https://firebase.google.com/docs/auth/web/apple)). |

Also add your domains (e.g. `jambud.co`, your Cloud Run URL, and `localhost`) under
**Authentication → Settings → Authorized domains**.

## 3. Create Firestore and Storage

1. **Build → Firestore Database → Create database** (production mode).
2. **Build → Storage → Get started**.

### Security rules

Firestore rules (**Firestore Database → Rules**) — each user can only touch their own data:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /library/{itemId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

Storage rules (**Storage → Rules**) — audio files are private per user:

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## 4. Configure the app

### Local development

Add the values to your `.env` file (see `.env.example`):

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

Restart `npm run dev` after changing `.env`.

> Note: the Firebase web config is not a secret — access is enforced by the security
> rules above — so it is safe to bake into the client bundle.

### Production (Docker / Cloud Run)

Vite embeds these values in the client bundle **at build time**, so they must be passed
as Docker build args:

```bash
gcloud builds submit \
  --tag YOUR_REGION-docker.pkg.dev/YOUR_PROJECT_ID/musician-buddy-repo/musician-buddy \
  --build-arg VITE_FIREBASE_API_KEY=... \
  --build-arg VITE_FIREBASE_AUTH_DOMAIN=... \
  --build-arg VITE_FIREBASE_PROJECT_ID=... \
  --build-arg VITE_FIREBASE_STORAGE_BUCKET=... \
  --build-arg VITE_FIREBASE_MESSAGING_SENDER_ID=... \
  --build-arg VITE_FIREBASE_APP_ID=...
```

If you use a Cloud Build trigger for continuous deployment, add the same values as
substitution variables in the trigger and forward them to Docker as `--build-arg`s in
your `cloudbuild.yaml` build step.

## What users get

- **Sign in** with Google, Apple, or Email + Password (create account supported in-app).
- **Save to Profile** buttons on generated lesson plans, songs, and audio clips.
- **Download** buttons for lesson plans / songs (Markdown) and audio (MP3).
- **My Library** (header icon or account menu) to browse, play, re-download, and delete saved items.
- The musician profile (instrument, skill level, goals) syncs to their account and follows them across devices.

## Data model

```
users/{uid}                     -> { profile, email, displayName, updatedAt }
users/{uid}/library/{itemId}    -> { type: 'lesson-plan' | 'song' | 'audio',
                                     title, content, audioUrl?, audioPath?, createdAt }
Storage: users/{uid}/audio/{itemId}.mp3
```
