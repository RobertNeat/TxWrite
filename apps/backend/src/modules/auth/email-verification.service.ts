import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service.js';
import { MailService } from './mail/mail.service.js';

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;

/** Machine-readable codes so the frontend can show a specific Polish message (and, for CODE_EXPIRED/CODE_LOCKED, offer a resend) instead of a generic "wrong credentials". */
export class CodeInvalidException extends BadRequestException {
  constructor() {
    super({ code: 'CODE_INVALID', message: 'Invalid verification code' });
  }
}

export class CodeExpiredException extends BadRequestException {
  constructor() {
    super({ code: 'CODE_EXPIRED', message: 'Verification code expired' });
  }
}

export class CodeLockedException extends ForbiddenException {
  constructor() {
    super({ code: 'CODE_LOCKED', message: 'Too many incorrect attempts' });
  }
}

export class NoPendingCodeException extends BadRequestException {
  constructor() {
    super({ code: 'CODE_INVALID', message: 'No pending verification code' });
  }
}

interface CodeRow {
  user_id: string;
  code_hash: string;
  expires_at: string;
  attempts: number;
  created_at: string;
}

function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

function generateCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly mail: MailService,
  ) {}

  private getRow(userId: string): CodeRow | undefined {
    return this.database.db
      .prepare('SELECT * FROM email_verification_codes WHERE user_id = ?')
      .get(userId) as unknown as CodeRow | undefined;
  }

  /** Issues (or re-issues) a code and emails it. Used by register and resend. */
  async issue(userId: string, email: string): Promise<void> {
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
    this.database.db
      .prepare(
        `INSERT INTO email_verification_codes (user_id, code_hash, expires_at, attempts, created_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT (user_id) DO UPDATE SET
           code_hash = excluded.code_hash,
           expires_at = excluded.expires_at,
           attempts = 0,
           created_at = excluded.created_at`,
      )
      .run(userId, hashCode(code), expiresAt, new Date().toISOString());
    await this.mail.sendVerificationCode(email, code);
  }

  /** Throws if a resend was requested too recently, to prevent mail-spam abuse. */
  assertResendAllowed(userId: string): void {
    const row = this.getRow(userId);
    if (!row) return;
    const elapsed = Date.now() - new Date(row.created_at).getTime();
    if (elapsed < RESEND_COOLDOWN_MS) {
      throw new ForbiddenException(
        'Please wait before requesting another code',
      );
    }
  }

  /** Verifies the code, marking the user as verified on success. Throws on bad/expired/locked-out code. */
  verify(userId: string): void {
    this.database.db
      .prepare('UPDATE users SET email_verified_at = ? WHERE id = ?')
      .run(new Date().toISOString(), userId);
    this.database.db
      .prepare('DELETE FROM email_verification_codes WHERE user_id = ?')
      .run(userId);
  }

  /** Throws CodeInvalid/CodeExpired/CodeLocked/NoPendingCode on failure; returns normally only on a correct code. */
  checkCode(userId: string, code: string): void {
    const row = this.getRow(userId);
    if (!row) {
      throw new NoPendingCodeException();
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      throw new CodeLockedException();
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new CodeExpiredException();
    }

    const candidate = hashCode(code);
    const expected = Buffer.from(row.code_hash, 'hex');
    const actual = Buffer.from(candidate, 'hex');
    const matches =
      actual.length === expected.length && timingSafeEqual(actual, expected);

    if (!matches) {
      this.database.db
        .prepare(
          'UPDATE email_verification_codes SET attempts = attempts + 1 WHERE user_id = ?',
        )
        .run(userId);
      throw new CodeInvalidException();
    }
  }

  isVerified(userId: string): boolean {
    const row = this.database.db
      .prepare('SELECT email_verified_at FROM users WHERE id = ?')
      .get(userId) as unknown as
      { email_verified_at: string | null } | undefined;
    return !!row?.email_verified_at;
  }
}
