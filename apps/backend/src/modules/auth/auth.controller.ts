import {
  Body,
  Controller,
  Post,
  Get,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto } from './auth.dto.js';
import { Public } from './public.decorator.js';
import {
  CurrentUserId,
  CurrentAccessTokenExpiry,
} from './current-user.decorator.js';
import {
  setAuthCookies,
  clearAuthCookies,
  REFRESH_TOKEN_COOKIE,
} from './cookies.js';
import type { User } from './user.entity.js';

interface AuthResponse {
  user: User;
  accessTokenExpiresAt: string;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.authService.register(
      dto.email,
      dto.password,
      dto.displayName,
    );
    setAuthCookies(reply, this.config, tokens);
    return {
      user,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
    };
  }

  @Public()
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthResponse> {
    const { user, tokens } = await this.authService.login(
      dto.email,
      dto.password,
    );
    setAuthCookies(reply, this.config, tokens);
    return {
      user,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString(),
    };
  }

  @Public()
  @Post('refresh')
  refresh(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { accessTokenExpiresAt: string } {
    const presented = request.cookies?.[REFRESH_TOKEN_COOKIE];
    if (!presented) {
      clearAuthCookies(reply, this.config);
      throw new UnauthorizedException('No refresh token');
    }
    const tokens = this.authService.refresh(presented);
    setAuthCookies(reply, this.config, tokens);
    return { accessTokenExpiresAt: tokens.accessTokenExpiresAt.toISOString() };
  }

  @Public()
  @Post('logout')
  logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): { ok: true } {
    this.authService.logout(request.cookies?.[REFRESH_TOKEN_COOKIE]);
    clearAuthCookies(reply, this.config);
    return { ok: true };
  }

  @Get('me')
  me(
    @CurrentUserId() userId: string,
    @CurrentAccessTokenExpiry() accessTokenExpiresAt: Date | undefined,
  ): AuthResponse {
    return {
      user: this.authService.me(userId),
      accessTokenExpiresAt: (accessTokenExpiresAt ?? new Date()).toISOString(),
    };
  }
}
