
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { localDb, localUser } from './localPlatform';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

/**
 * When true: real Firebase Auth + Firestore. When false: localPlatform (localStorage).
 * - Set `VITE_USE_FIREBASE=true` to force cloud even in dev (e.g. emulator or staging).
 * - Set `VITE_USE_FIREBASE=false` to force local even in production builds (e.g. AI Studio preview).
 * - If unset: follow Vite's `import.meta.env.PROD` (true after `vite build`, false in `vite dev`).
 *
 * Prefer this over `process.env.NODE_ENV`: some hosted build pipelines do not define the latter
 * in the browser bundle, which incorrectly kept production deploys on the local backend.
 */
const viteFirebaseFlag = import.meta.env.VITE_USE_FIREBASE;
export const shouldUseFirebase =
  viteFirebaseFlag === 'true'
    ? true
    : viteFirebaseFlag === 'false'
      ? false
      : import.meta.env.PROD;

let db, auth, googleProvider;

if (shouldUseFirebase) {
  const app = initializeApp(firebaseConfig);
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true
  });
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
} else {
  db = localDb;
  auth = {
    currentUser: localUser,
    onAuthStateChanged: (callback: (user: typeof localUser | null) => void) => {
      try {
        callback(localUser);
      } catch (error) {
        console.error('Local auth onAuthStateChanged callback failed', error);
      }
      return () => {};
    },
    signOut: async () => {
      console.info('Local test mode keeps the Local Tester account signed in.');
    }
  };
  googleProvider = null;
}

export { db, auth, googleProvider };

export const signInWithGoogle = async () => {
  if (shouldUseFirebase) {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Error signing in with Google: ", error);
    }
  } else {
    console.info('Local test mode uses the built-in Local Tester account.');
  }
};

export const logout = async () => {
  if (shouldUseFirebase) {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out: ", error);
    }
  } else {
    console.info('Local test mode keeps the Local Tester account signed in.');
  }
};

export interface FirestoreErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write';
  path: string | null;
  authInfo: {
    userId: string;
    email: string;
    emailVerified: boolean;
    isAnonymous: boolean;
    providerInfo: { providerId: string; displayName: string; email: string; }[];
  };
}

export const handleFirestoreError = (
  error: any,
  operationType: FirestoreErrorInfo['operationType'],
  path: string | null = null
) => {
  const user = auth.currentUser;
  const errorInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      isAnonymous: user.isAnonymous,
      providerInfo: user.providerData
    }
  };

  console.error('Firestore operation failed', errorInfo);
  throw error;
};

