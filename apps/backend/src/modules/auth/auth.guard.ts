import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { TokenService } from './token.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { ACCESS_TOKEN_COOKIE } from './cookies.js';

export interface AuthenticatedRequest {
  userId: string;
  accessTokenExpiresAt?: Date;
}

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly tokenService: TokenService,
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    // The Angular dev server proxies /api with changeOrigin:true, which
    // rewrites Host to the backend's but leaves the browser's Origin header
    // as the dev server's own (e.g. http://localhost:4200) — same-origin
    // equality would reject every mutating dev request, so known dev/deploy
    // origins are allowlisted via env instead of compared against Host.
    const extra = config.get<string>('EXTRA_ALLOWED_ORIGINS', '');
    this.allowedOrigins = new Set(
      extra
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & AuthenticatedRequest>();

    if (isPublic) {
      // Still attach userId when a valid cookie is present (e.g. /auth/me-like
      // public endpoints that behave differently when already logged in);
      // failures are ignored since the route is public.
      this.tryAttachUser(request);
      return true;
    }

    this.assertSameOrigin(request);

    const token = request.cookies?.[ACCESS_TOKEN_COOKIE];
    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }
    try {
      const payload = this.tokenService.verifyAccessToken(token);
      request.userId = payload.sub;
      request.accessTokenExpiresAt = new Date(payload.exp * 1000);
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
    return true;
  }

  private tryAttachUser(request: FastifyRequest & AuthenticatedRequest): void {
    const token = request.cookies?.[ACCESS_TOKEN_COOKIE];
    if (!token) return;
    try {
      const payload = this.tokenService.verifyAccessToken(token);
      request.userId = payload.sub;
      request.accessTokenExpiresAt = new Date(payload.exp * 1000);
    } catch {
      // ignored — public route, missing/invalid session is fine
    }
  }

  /**
   * SameSite=Strict on our cookies already blocks cross-site browsing
   * navigations from sending them; this catches the remaining case
   * (same-site but cross-origin fetch/XHR, e.g. a malicious subdomain or a
   * misconfigured proxy) as a lightweight extra CSRF layer for mutations.
   */
  private assertSameOrigin(request: FastifyRequest): void {
    if (SAFE_METHODS.has(request.method)) return;
    const origin = request.headers.origin;
    if (!origin) return; // non-browser clients (curl, server-to-server) have no Origin header
    const host = request.headers.host;
    if (!host) return;
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      throw new ForbiddenException('Invalid Origin header');
    }
    if (originHost === host || this.allowedOrigins.has(origin)) {
      return;
    }
    throw new ForbiddenException('Cross-origin request rejected');
  }
}
