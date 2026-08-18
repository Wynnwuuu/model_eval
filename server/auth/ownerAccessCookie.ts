import type { Request, Response } from 'express';

export const OWNER_ACCESS_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export const getOwnerAccessCookieName = () => process.env.NODE_ENV === 'production'
  ? '__Secure-manueval-owner-session'
  : 'manueval-owner-session';

const cookieAttributes = () => [
  'HttpOnly',
  'SameSite=Strict',
  'Path=/api',
  ...(process.env.NODE_ENV === 'production' ? ['Secure'] : []),
];

export const readOwnerAccessCookie = (req: Request) => {
  const cookieHeader = req.header('cookie') || '';
  const cookieName = getOwnerAccessCookieName();
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== cookieName) continue;
    const value = entry.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return '';
    }
  }
  return '';
};

export const setOwnerAccessCookie = (res: Response, token: string) => {
  const maxAge = OWNER_ACCESS_COOKIE_MAX_AGE_SECONDS;
  const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
  res.append('Set-Cookie', [
    `${getOwnerAccessCookieName()}=${encodeURIComponent(token)}`,
    ...cookieAttributes(),
    `Max-Age=${maxAge}`,
    `Expires=${expires}`,
  ].join('; '));
};

export const clearOwnerAccessCookie = (res: Response) => {
  res.append('Set-Cookie', [
    `${getOwnerAccessCookieName()}=`,
    ...cookieAttributes(),
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ].join('; '));
};
