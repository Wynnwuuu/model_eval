import { auth, shouldUseCloudAuth } from '../auth';
import { safeGetStorageItem } from '../safeBrowserStorage';

export const getApiAuthHeaders = () => {
  const token = safeGetStorageItem(localStorage, 'token', { kind: 'auth' }).value;
  if (token) {
    return {
      Authorization: `Bearer ${token}`,
    };
  }

  // Cloud sessions without a Bearer token are authenticated by the owner's
  // HttpOnly cookie. Do not attach the local-development identity headers:
  // display names may contain Unicode, which browsers reject in HTTP headers,
  // and the server must not let those headers override the cookie identity.
  if (shouldUseCloudAuth) return {};

  const user = auth.currentUser;
  const userId = user?.uid || 'local-dev-user';
  const email = user?.email || `${userId}@local.eval`;
  const displayName = user?.displayName || email;

  return {
    'X-User-Id': userId,
    'X-User-Email': email,
    'X-User-Name': displayName,
    'X-Organization-Id': 'default',
  };
};
