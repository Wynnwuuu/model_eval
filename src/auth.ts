import { localDb, localUser } from './localPlatform';
import { API_BASE_URL } from './runtimeConfig';
import {
  AuthStorageError,
  safeGetStorageItem,
  safeRemoveStorageItem,
  safeSetStorageItem,
  setRequiredAuthStorageItems,
} from './safeBrowserStorage';

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

export class AuthRequestError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const TOKEN_KEY = 'token';
const USER_KEY = 'manueval_user';

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
  const raw = safeGetStorageItem(localStorage, USER_KEY, { kind: 'auth' }).value;
  if (!raw) return null;
  try {
    return toAppUser(JSON.parse(raw));
  } catch {
    safeRemoveStorageItem(localStorage, USER_KEY, { kind: 'auth' });
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
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new AuthRequestError(
      response.status,
      payload?.error?.code || 'AUTH_REQUEST_FAILED',
      payload?.error?.message || payload?.detail || `Auth request failed (${response.status})`,
    );
  }
  return response.json();
};

const storeSession = (accessToken: string, user: ApiUser) => {
  setRequiredAuthStorageItems(localStorage, [
    [TOKEN_KEY, accessToken],
    [USER_KEY, JSON.stringify(user)],
  ]);
  notify(toAppUser(user));
};

const storeOwnerSession = (user: ApiUser) => {
  safeRemoveStorageItem(localStorage, TOKEN_KEY, { kind: 'auth' });
  const stored = safeSetStorageItem(localStorage, USER_KEY, JSON.stringify(user), { kind: 'auth' });
  notify(toAppUser(user));
  if (!stored.ok) {
    console.warn('Owner user profile could not be cached; the HttpOnly session remains active');
  }
};

export const getAuthToken = () => safeGetStorageItem(localStorage, TOKEN_KEY, { kind: 'auth' }).value || null;

export const getCurrentUserDisplayName = () => {
  const user = auth.currentUser;
  return user?.displayName || user?.email || safeGetStorageItem(localStorage, 'eval_username', { report: false }).value || 'Anonymous';
};

export const getCurrentReviewerIdentity = () => {
  const user = auth.currentUser;
  const displayName = user?.displayName || user?.email || safeGetStorageItem(localStorage, 'eval_username', { report: false }).value || 'Anonymous';
  const email = user?.email || '';
  return {
    id: user?.uid || email || displayName,
    displayName,
    email,
  };
};

export const refreshCurrentUser = async () => {
  if (!shouldUseCloudAuth) {
    notify(localUser);
    return localUser;
  }
  const token = getAuthToken();
  try {
    const payload = await requestAuthJson<{ user: ApiUser }>('/api/auth/user/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    const stored = safeSetStorageItem(localStorage, USER_KEY, JSON.stringify(payload.user), { kind: 'auth' });
    const user = toAppUser(payload.user);
    notify(user);
    if (!stored.ok) throw new AuthStorageError(stored.issue!);
    return user;
  } catch (error) {
    if (!(error instanceof AuthRequestError) || error.status !== 401) {
      console.error('Failed to refresh auth user', error);
    }
    if (error instanceof AuthStorageError) return auth.currentUser;
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
  const currentPath = `${window.location.pathname}${window.location.search}`;
  if (currentPath && currentPath !== '/login' && currentPath !== '/feishu-callback') {
    safeSetStorageItem(sessionStorage, 'redirectAfterLogin', currentPath);
  }
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

export const signInWithOwnerAccess = async (fingerprint: string, accessKey: string) => {
  const token = getAuthToken();
  const payload = await requestAuthJson<{ user: ApiUser }>('/api/auth/owner/access', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: JSON.stringify({ fingerprint, accessKey }),
  });
  storeOwnerSession(payload.user);
  return toAppUser(payload.user);
};

export const signInWithGoogle = signInWithFeishu;

export const logout = async () => {
  const token = getAuthToken();
  try {
    await fetch(`${API_BASE_URL}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
  } catch (error) {
    console.warn('Server logout could not be completed; local session data was still cleared', error);
  }
  safeRemoveStorageItem(localStorage, TOKEN_KEY, { kind: 'auth' });
  safeRemoveStorageItem(localStorage, USER_KEY, { kind: 'auth' });
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
