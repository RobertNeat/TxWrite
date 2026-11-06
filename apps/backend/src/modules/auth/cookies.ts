import type { FastifyReply } from 'fastify';
import type { ConfigService } from '@nestjs/config';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
export const AUTH_COOKIE_PATH = '/api/auth';

function cookieSecure(config: ConfigService): boolean {
  // Plain HTTP on a LAN/Docker deployment silently drops Secure cookies —
  // must be overridable per docs/project_assumptons/architecture.md section 8.
  return config.get<string>('COOKIE_SECURE', 'true') === 'true';
}

export function setAuthCookies(
  reply: FastifyReply,
  config: ConfigService,
  tokens: {
    accessToken: string;
    accessTokenExpiresAt: Date;
    refreshToken: string;
    refreshTokenExpiresAt: Date;
  },
): void {
  const secure = cookieSecure(config);
  reply.setCookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    expires: tokens.accessTokenExpiresAt,
  });
  reply.setCookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: AUTH_COOKIE_PATH,
    expires: tokens.refreshTokenExpiresAt,
  });
}

export function clearAuthCookies(
  reply: FastifyReply,
  config: ConfigService,
): void {
  const secure = cookieSecure(config);
  reply.clearCookie(ACCESS_TOKEN_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
  });
  reply.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: AUTH_COOKIE_PATH,
  });
}
