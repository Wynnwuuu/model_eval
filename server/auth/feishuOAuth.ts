import { serverConfig } from '../config.ts';
import { ApiError } from '../http/errors.ts';

export type FeishuUserInfo = {
  openId: string;
  unionId: string;
  name: string;
  email?: string;
  avatarUrl?: string;
};

const AUTH_URL = 'https://open.feishu.cn/open-apis/authen/v1/authorize';
const ACCESS_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token';
const USER_INFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';
const APP_ACCESS_TOKEN_URL = 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal';

const ensureFeishuConfig = () => {
  if (!serverConfig.feishuAppId || !serverConfig.feishuAppSecret || !serverConfig.feishuRedirectUri) {
    throw new ApiError(500, 'FEISHU_NOT_CONFIGURED', 'Feishu OAuth is not configured');
  }
};

const readFeishuJson = async <T>(response: Response, operation: string): Promise<T> => {
  if (!response.ok) {
    throw new ApiError(response.status, 'FEISHU_REQUEST_FAILED', `${operation} failed`);
  }
  const data: any = await response.json();
  if (data.code !== 0) {
    const message = data.message || data.msg || `${operation} failed`;
    throw new ApiError(401, 'FEISHU_AUTH_FAILED', message);
  }
  return data as T;
};

export const getFeishuAuthorizationUrl = () => {
  ensureFeishuConfig();
  const params = new URLSearchParams({
    app_id: serverConfig.feishuAppId,
    redirect_uri: serverConfig.feishuRedirectUri,
    response_type: 'code',
  });
  return `${AUTH_URL}?${params.toString()}`;
};

const getAppAccessToken = async () => {
  ensureFeishuConfig();
  const response = await fetch(APP_ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: serverConfig.feishuAppId,
      app_secret: serverConfig.feishuAppSecret,
    }),
  });
  const data = await readFeishuJson<{ app_access_token: string }>(response, 'Get Feishu app access token');
  return data.app_access_token;
};

const exchangeCodeForToken = async (code: string) => {
  const appAccessToken = await getAppAccessToken();
  const response = await fetch(ACCESS_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
    }),
  });
  const data = await readFeishuJson<{ data: { access_token: string } }>(response, 'Exchange Feishu code');
  return data.data.access_token;
};

const getUserInfo = async (accessToken: string): Promise<FeishuUserInfo> => {
  const response = await fetch(USER_INFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const data = await readFeishuJson<{
    data: {
      open_id: string;
      union_id?: string;
      name?: string;
      email?: string;
      avatar_url?: string;
    };
  }>(response, 'Get Feishu user info');
  return {
    openId: data.data.open_id,
    unionId: data.data.union_id || '',
    name: data.data.name || 'Feishu User',
    email: data.data.email,
    avatarUrl: data.data.avatar_url,
  };
};

export const authenticateFeishuCode = async (code: string) => {
  const accessToken = await exchangeCodeForToken(code);
  return getUserInfo(accessToken);
};
