import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedRequest } from './auth.guard.js';

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx
      .switchToHttp()
      .getRequest<FastifyRequest & AuthenticatedRequest>();
    return request.userId;
  },
);

export const CurrentAccessTokenExpiry = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Date | undefined => {
    const request = ctx
      .switchToHttp()
      .getRequest<FastifyRequest & AuthenticatedRequest>();
    return request.accessTokenExpiresAt;
  },
);
