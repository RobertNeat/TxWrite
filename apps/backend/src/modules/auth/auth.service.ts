import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { UsersService } from './users.service.js';
import { PasswordService } from './password.service.js';
import { TokenService, type IssuedTokens } from './token.service.js';
import {
  EmailVerificationService,
  NoPendingCodeException,
} from './email-verification.service.js';
import type { User } from './user.entity.js';

/** Thrown by login() when credentials are correct but the email isn't verified yet — distinct from a 401 so the frontend can route to the code-entry screen instead of showing "wrong password". */
export class EmailNotVerifiedException extends ForbiddenException {
  constructor() {
    super({ code: 'EMAIL_NOT_VERIFIED', message: 'Email not verified' });
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  /** Creates the account and emails a verification code; issues no session cookies yet. */
  async register(
    email: string,
    password: string,
    displayName: string,
  ): Promise<User> {
    const passwordHash = await this.passwords.hash(password);
    const user = this.users.createLocal(email, passwordHash, displayName);
    await this.emailVerification.issue(user.id, email);
    return user;
  }

  async resendVerification(email: string): Promise<void> {
    const user = this.users.findByEmail(email);
    if (!user || this.emailVerification.isVerified(user.id)) {
      // Same outcome whether the account doesn't exist or is already
      // verified, so this endpoint can't be used to probe registered emails.
      return;
    }
    this.emailVerification.assertResendAllowed(user.id);
    await this.emailVerification.issue(user.id, email);
  }

  /** Verifies the code and, on success, starts the session — same shape as login/register. */
  verifyEmail(
    email: string,
    code: string,
  ): { user: User; tokens: IssuedTokens } {
    const user = this.users.findByEmail(email);
    if (!user) {
      throw new NoPendingCodeException();
    }
    this.emailVerification.checkCode(user.id, code);
    this.emailVerification.verify(user.id);
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
    // Checked after the password so a wrong password always looks the same
    // (401) regardless of verification state — otherwise this would leak
    // whether an email is registered.
    if (!this.emailVerification.isVerified(identity.user_id)) {
      // A returning user who closed the tab before entering the original
      // code (now likely expired) needs a fresh one — without this, the
      // frontend's code-entry screen would claim "we sent you a code" while
      // the only one that ever existed silently expired 15 minutes ago.
      // assertResendAllowed's cooldown prevents this from being a resend-spam
      // vector on every failed login attempt.
      try {
        this.emailVerification.assertResendAllowed(identity.user_id);
        await this.emailVerification.issue(identity.user_id, email);
      } catch {
        // Cooldown active — a code was already (re)sent recently; nothing to do.
      }
      throw new EmailNotVerifiedException();
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
