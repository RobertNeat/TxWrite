import { Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from './users.service.js';
import { PasswordService } from './password.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import type { User } from './user.entity.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
  ) {}

  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<{ user: User; tokens: IssuedTokens }> {
    const passwordHash = await this.passwords.hash(password);
    const user = this.users.createLocal(email, passwordHash, displayName);
    return { user, tokens: this.tokens.issueFor(user.id) };
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ user: User; tokens: IssuedTokens }> {
    const identity = this.users.findLocalIdentityByEmail(email);
    if (!identity?.password_hash) {
      await this.passwords.hashDummy();
      throw new UnauthorizedException('Invalid email or password');
    }
    const valid = await this.passwords.verify(password, identity.password_hash);
    if (!valid) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const user = this.users.findById(identity.user_id)!;
    return { user, tokens: this.tokens.issueFor(user.id) };
  }

  refresh(refreshToken: string): IssuedTokens {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string | undefined): void {
    if (refreshToken) {
      this.tokens.revokeToken(refreshToken);
    }
  }

  me(userId: string): User {
    const user = this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException('Session user no longer exists');
    }
    return user;
  }
}
