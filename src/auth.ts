import { localDb, localUser } from './localPlatform';

export const shouldUseCloudAuth = false;

export const db = localDb;

export const auth = {
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

export const signInWithGoogle = async () => {
  console.info('Local test mode uses the built-in Local Tester account.');
};

export const logout = async () => {
  console.info('Local test mode keeps the Local Tester account signed in.');
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
