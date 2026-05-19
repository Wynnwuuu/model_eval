import { localDb, localUser } from './localPlatform';

export const shouldUseCloudAuth = (import.meta.env.VITE_AUTH_MODE || '').toLowerCase() === 'feishu';

export const db = localDb;

type AppUser = typeof localUser & {
  avatarUrl?: string | null;
  organizationId?: string;
};

type ApiUser = {
  id: string;
  email: string;
  displayName: string;
  organizationId?: string;
  avatarUrl?: string | null;
};

const TOKEN_KEY = 'token';
const USER_KEY = 'manueval_user';

const USE_API_BACKEND =
  import.meta.env.VITE_USE_API_BACKEND === 'true' ||
  Boolean(import.meta.env.VITE_API_BASE_URL);
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || (USE_API_BACKEND ? '' : '')).replace(/\/+$/, '');

const listeners = new Set<(user: AppUser | null) => void>();

const toAppUser = (user: ApiUser): AppUser => ({
  ...localUser,
  uid: user.id,
  email: user.email,
  displayName: user.displayName,
  avatarUrl: user.avatarUrl,
  organizationId: user.organizationId || 'default',
  providerData: [
    {
      providerId: 'feishu',
      displayName: user.displayName,
      email: user.email,
    },
  ],
});

const readStoredUser = (): AppUser | null => {
  if (!shouldUseCloudAuth) return localUser;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return toAppUser(JSON.parse(raw));
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
};

const notify = (user: AppUser | null) => {
  auth.currentUser = user;
  listeners.forEach(listener => {
    try {
      listener(user);
    } catch (error) {
      console.error('Auth state callback failed', error);
    }
  });
};

const requestAuthJson = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || payload?.detail || `Auth request failed (${response.status})`);
  }
  return response.json();
};

const storeSession = (accessToken: string, user: ApiUser) => {
  localStorage.setItem(TOKEN_KEY, accessToken);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  notify(toAppUser(user));
};

export const getAuthToken = () => localStorage.getItem(TOKEN_KEY);

export const refreshCurrentUser = async () => {
  if (!shouldUseCloudAuth) {
    notify(localUser);
    return localUser;
  }
  const token = getAuthToken();
  if (!token) {
    notify(null);
    return null;
  }
  try {
    const payload = await requestAuthJson<{ user: ApiUser }>('/api/auth/user/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
    const user = toAppUser(payload.user);
    notify(user);
    return user;
  } catch (error) {
    console.error('Failed to refresh auth user', error);
    await logout();
    return null;
  }
};

export const auth = {
  currentUser: readStoredUser(),
  onAuthStateChanged: (callback: (user: AppUser | null) => void) => {
    listeners.add(callback);
    callback(auth.currentUser);
    if (shouldUseCloudAuth) {
      void refreshCurrentUser();
    }
    return () => {
      listeners.delete(callback);
    };
  },
  signOut: async () => {
    await logout();
  },
};

export const signInWithFeishu = async () => {
  const payload = await requestAuthJson<{ authorizationUrl: string }>('/api/auth/feishu/login-url');
  window.location.href = payload.authorizationUrl;
};

export const completeFeishuLogin = async (code: string) => {
  const payload = await requestAuthJson<{ accessToken: string; user: ApiUser }>('/api/auth/feishu/callback', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  storeSession(payload.accessToken, payload.user);
  return toAppUser(payload.user);
};

export const signInWithGoogle = signInWithFeishu;

export const logout = async () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  notify(shouldUseCloudAuth ? null : localUser);
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
