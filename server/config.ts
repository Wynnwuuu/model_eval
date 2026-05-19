import 'dotenv/config';

const DEFAULT_DATABASE_URL = 'postgresql://eval_studio:eval_studio_dev@localhost:5432/eval_studio';

const parsePort = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const serverConfig = {
  apiPort: parsePort(process.env.API_PORT, 8787),
  databaseUrl: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
  databaseConnectionTimeoutMs: parsePort(process.env.DATABASE_CONNECTION_TIMEOUT_MS, 15000),
  authMode: (process.env.AUTH_MODE || 'local').toLowerCase(),
  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresDays: parsePort(process.env.JWT_EXPIRES_DAYS, 7),
  feishuAppId: process.env.FEISHU_APP_ID || '',
  feishuAppSecret: process.env.FEISHU_APP_SECRET || '',
  feishuRedirectUri: process.env.FEISHU_REDIRECT_URI || '',
};
