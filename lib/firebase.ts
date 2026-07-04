import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';

// The Firebase *web* config is public by design (it ships in the JS bundle);
// access control comes from Firestore/Storage security rules and the
// authorized-domains list, not from hiding these values. Committing them
// here lets the production Docker build work without build args.
const DEFAULT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDZcQB9vr_3Chh8vJQEjOl-ifuXwGZSINA',
  authDomain: 'api-connector-mcp.firebaseapp.com',
  projectId: 'api-connector-mcp',
  storageBucket: 'api-connector-mcp.firebasestorage.app',
  messagingSenderId: '243585371458',
  appId: '1:243585371458:web:bd84887488704900e20cdb',
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || DEFAULT_FIREBASE_CONFIG.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_FIREBASE_CONFIG.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_FIREBASE_CONFIG.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || DEFAULT_FIREBASE_CONFIG.storageBucket,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_FIREBASE_CONFIG.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || DEFAULT_FIREBASE_CONFIG.appId,
};

/**
 * True when the Firebase web config has been provided via VITE_FIREBASE_* env
 * vars. When false the app still works (chat, downloads), but sign-in and
 * save-to-profile features are disabled with a setup notice.
 */
export const isFirebaseConfigured = !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let storage: FirebaseStorage | null = null;

if (isFirebaseConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}

export { app, auth, db, storage };
