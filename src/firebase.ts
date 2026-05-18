import { initializeApp } from '@firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from '@firebase/auth';
import { localDb, localUser } from './localPlatform';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const viteCloudAuthFlag = import.meta.env.VITE_USE_FIREBASE_AUTH;
export const shouldUseCloudAuth = viteCloudAuthFlag === 'true';

let auth: any;
let googleProvider: GoogleAuthProvider | null = null;

if (shouldUseCloudAuth) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
} else {
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
}

export const db = localDb;
export { auth, googleProvider };

export const signInWithGoogle = async () => {
  if (shouldUseCloudAuth && googleProvider) {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Error signing in with Google: ', error);
    }
  } else {
    console.info('Local test mode uses the built-in Local Tester account.');
  }
};

export const logout = async () => {
  if (shouldUseCloudAuth) {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Error signing out: ', error);
    }
  } else {
    console.info('Local test mode keeps the Local Tester account signed in.');
  }
};

export interface PersistenceErrorInfo {
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

export const handlePersistenceError = (
  error: any,
  operationType: PersistenceErrorInfo['operationType'],
  path: string | null = null
) => {
  const user = auth.currentUser || localUser;
  const errorInfo: PersistenceErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
    authInfo: {
      userId: user.uid,
      email: user.email,
      emailVerified: Boolean(user.emailVerified),
      isAnonymous: Boolean(user.isAnonymous),
      providerInfo: user.providerData || []
    }
  };

  console.error('Persistence operation failed', errorInfo);
  throw error;
};
