import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../../common/database/database.service.js';
import {
  CodeExpiredException,
  CodeInvalidException,
  CodeLockedException,
  EmailVerificationService,
  NoPendingCodeException,
} from './email-verification.service.js';
import { MailService } from './mail/mail.service.js';

class FakeMailService {
  readonly sentCodes = new Map<string, string>();
  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.sentCodes.set(email, code);
  }
}

describe('EmailVerificationService', () => {
  let service: EmailVerificationService;
  let database: DatabaseService;
  let mail: FakeMailService;
  const userId = 'user-1';
  const email = 'alice@example.com';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailVerificationService,
        DatabaseService,
        { provide: ConfigService, useValue: { get: () => ':memory:' } },
        { provide: MailService, useClass: FakeMailService },
      ],
    }).compile();

    service = module.get(EmailVerificationService);
    database = module.get(DatabaseService);
    mail = module.get(MailService) as unknown as FakeMailService;
    database.db
      .prepare('INSERT INTO users (id, display_name) VALUES (?, ?)')
      .run(userId, 'Alice');
  });

  it('issues a 6-digit code and emails it', async () => {
    await service.issue(userId, email);
    const code = mail.sentCodes.get(email);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('accepts the correct code', async () => {
    await service.issue(userId, email);
    const code = mail.sentCodes.get(email)!;
    expect(() => service.checkCode(userId, code)).not.toThrow();
  });

  it('rejects an incorrect code without marking the user verified', async () => {
    await service.issue(userId, email);
    expect(() => service.checkCode(userId, '000000')).toThrow(
      CodeInvalidException,
    );
    expect(service.isVerified(userId)).toBe(false);
  });

  it('verify() marks the user verified and removes the code row', async () => {
    await service.issue(userId, email);
    const code = mail.sentCodes.get(email)!;
    service.checkCode(userId, code);
    service.verify(userId);
    expect(service.isVerified(userId)).toBe(true);
    expect(() => service.checkCode(userId, code)).toThrow(
      NoPendingCodeException,
    );
  });

  it('locks out after 5 incorrect attempts even with the right code afterwards', async () => {
    await service.issue(userId, email);
    const code = mail.sentCodes.get(email)!;
    for (let i = 0; i < 5; i++) {
      try {
        service.checkCode(userId, '000000');
      } catch {
        // expected — collecting failed attempts
      }
    }
    expect(() => service.checkCode(userId, code)).toThrow(CodeLockedException);
  });

  it('rejects an expired code', async () => {
    await service.issue(userId, email);
    const code = mail.sentCodes.get(email)!;
    database.db
      .prepare(
        'UPDATE email_verification_codes SET expires_at = ? WHERE user_id = ?',
      )
      .run(new Date(Date.now() - 1000).toISOString(), userId);
    expect(() => service.checkCode(userId, code)).toThrow(CodeExpiredException);
  });

  it('re-issuing resets attempts and replaces the previous code', async () => {
    await service.issue(userId, email);
    try {
      service.checkCode(userId, '000000');
    } catch {
      // expected
    }
    await service.issue(userId, email);
    const newCode = mail.sentCodes.get(email)!;
    expect(() => service.checkCode(userId, newCode)).not.toThrow();
  });

  describe('assertResendAllowed', () => {
    it('throws when a code was just issued (cooldown active)', async () => {
      await service.issue(userId, email);
      expect(() => service.assertResendAllowed(userId)).toThrow(
        ForbiddenException,
      );
    });

    it('does not throw when no code has ever been issued', () => {
      expect(() => service.assertResendAllowed(userId)).not.toThrow();
    });

    it('does not throw once the cooldown has elapsed', async () => {
      await service.issue(userId, email);
      database.db
        .prepare(
          'UPDATE email_verification_codes SET created_at = ? WHERE user_id = ?',
        )
        .run(new Date(Date.now() - 61_000).toISOString(), userId);
      expect(() => service.assertResendAllowed(userId)).not.toThrow();
    });
  });
});
