import { auth } from '../firebase';

export const getApiAuthHeaders = () => {
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
