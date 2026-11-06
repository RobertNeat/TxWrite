import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app-setup.js';
import { MailService } from '../src/modules/auth/mail/mail.service.js';
import { DatabaseService } from '../src/common/database/database.service.js';

/** Parses `Set-Cookie` response headers into a single `Cookie` request header value. */
function cookieHeaderFrom(setCookieHeaders: string[] | undefined): string {
  return (setCookieHeaders ?? [])
    .map((header) => header.split(';')[0])
    .join('; ');
}

/** Captures codes instead of sending real email, so e2e tests can read what was "sent". */
class FakeMailService {
  readonly sentCodes = new Map<string, string>();

  async sendVerificationCode(email: string, code: string): Promise<void> {
    this.sentCodes.set(email, code);
  }
}

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;
  let dataDir: string;
  let fakeMail: FakeMailService;
  let database: DatabaseService;

  beforeEach(async () => {
    process.env.JWT_SECRET ??= 'e2e-test-secret-at-least-32-characters-long';
    // DatabaseService treats DATA_DIR===':memory:' specially for the SQLite
    // file, but ProjectFilesService uses the same env var as a real
    // filesystem root for project directories — so a disposable real path is
    // needed either way, not ':memory:'.
    dataDir = mkdtempSync(join(tmpdir(), 'ltx-e2e-'));
    process.env.DATA_DIR = dataDir;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(MailService)
      .useClass(FakeMailService)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    fakeMail = app.get(MailService) as unknown as FakeMailService;
    database = app.get(DatabaseService);
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  it('/api/health (GET)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).status).toBe('ok');
  });

  describe('auth', () => {
    /** Registers, then immediately verifies using the code captured by FakeMailService, returning the resulting session cookie. */
    async function register(email: string, displayName: string) {
      const registerResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, password: 'correct-password-123', displayName },
      });
      const code = fakeMail.sentCodes.get(email);
      expect(code).toBeTruthy();
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { email, code },
      });
      return {
        registerResponse,
        response,
        cookie: cookieHeaderFrom(
          response.cookies.map((c) => `${c.name}=${c.value}`),
        ),
      };
    }

    it('rejects unauthenticated access to a protected route', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/profiles',
      });
      expect(response.statusCode).toBe(401);
    });

    it('registers without issuing a session, then verify-email sets cookies and allows /auth/me', async () => {
      const registerResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'alice@example.com',
          password: 'correct-password-123',
          displayName: 'Alice',
        },
      });
      expect(registerResponse.statusCode).toBe(201);
      expect(JSON.parse(registerResponse.payload)).toEqual({
        pendingVerification: true,
        email: 'alice@example.com',
      });
      expect(registerResponse.cookies).toHaveLength(0);

      const code = fakeMail.sentCodes.get('alice@example.com');
      expect(code).toMatch(/^\d{6}$/);

      const verifyResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { email: 'alice@example.com', code },
      });
      expect(verifyResponse.statusCode).toBe(201);
      const cookie = cookieHeaderFrom(
        verifyResponse.cookies.map((c) => `${c.name}=${c.value}`),
      );
      expect(cookie).toContain('access_token=');
      expect(cookie).toContain('refresh_token=');

      const meResponse = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      });
      expect(meResponse.statusCode).toBe(200);
      const meBody = JSON.parse(meResponse.payload);
      expect(meBody.user.email).toBe('alice@example.com');
      expect(typeof meBody.accessTokenExpiresAt).toBe('string');
    });

    it('rejects an incorrect verification code without consuming it, and locks out after too many attempts', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'locked@example.com',
          password: 'correct-password-123',
          displayName: 'Locked',
        },
      });
      for (let i = 0; i < 5; i++) {
        const wrong = await app.inject({
          method: 'POST',
          url: '/api/auth/verify-email',
          payload: { email: 'locked@example.com', code: '000000' },
        });
        expect(wrong.statusCode).toBe(400);
        expect(JSON.parse(wrong.payload).code).toBe('CODE_INVALID');
      }
      const code = fakeMail.sentCodes.get('locked@example.com');
      const afterLockout = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { email: 'locked@example.com', code },
      });
      expect(afterLockout.statusCode).toBe(403);
    });

    it('login fails with EMAIL_NOT_VERIFIED when the password is correct but the account is unverified, and sends a fresh code', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'unverified@example.com',
          password: 'correct-password-123',
          displayName: 'Unverified',
        },
      });
      const registrationCode = fakeMail.sentCodes.get('unverified@example.com');

      // Simulate the registration code having gone stale (tab closed before
      // entering it, well past the 60s resend cooldown) before the user
      // comes back and logs in instead.
      database.db
        .prepare(
          'UPDATE email_verification_codes SET created_at = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)',
        )
        .run(
          new Date(Date.now() - 120_000).toISOString(),
          'unverified@example.com',
        );

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'unverified@example.com',
          password: 'correct-password-123',
        },
      });
      expect(loginResponse.statusCode).toBe(403);
      expect(JSON.parse(loginResponse.payload).code).toBe('EMAIL_NOT_VERIFIED');

      // A fresh code was issued as a side effect of the failed login, so the
      // code-entry screen's "we sent you a code" claim is actually true.
      const freshCode = fakeMail.sentCodes.get('unverified@example.com');
      expect(freshCode).toBeTruthy();
      expect(freshCode).not.toBe(registrationCode);

      const verifyResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/verify-email',
        payload: { email: 'unverified@example.com', code: freshCode },
      });
      expect(verifyResponse.statusCode).toBe(201);
    });

    it('logs in normally once the account is verified', async () => {
      await register('verified-login@example.com', 'Verified Login');

      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'verified-login@example.com',
          password: 'correct-password-123',
        },
      });
      expect(loginResponse.statusCode).toBe(201);
      const cookie = cookieHeaderFrom(
        loginResponse.cookies.map((c) => `${c.name}=${c.value}`),
      );
      expect(cookie).toContain('access_token=');

      const meResponse = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { cookie },
      });
      expect(meResponse.statusCode).toBe(200);
    });

    it('resend-verification enforces a cooldown (registering already issues a code, starting it)', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'resend@example.com',
          password: 'correct-password-123',
          displayName: 'Resend',
        },
      });

      const tooSoonResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/resend-verification',
        payload: { email: 'resend@example.com' },
      });
      expect(tooSoonResponse.statusCode).toBe(403);
    });

    it('resend-verification returns ok for an unknown email (no account enumeration)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/resend-verification',
        payload: { email: 'nobody@example.com' },
      });
      expect(response.statusCode).toBe(201);
    });

    it('rejects registration with a too-short password', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'short@example.com',
          password: 'short',
          displayName: 'Short',
        },
      });
      expect(response.statusCode).toBe(400);
    });

    it('rejects login with a wrong password', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'bob@example.com',
          password: 'correct-password-123',
          displayName: 'Bob',
        },
      });
      const loginResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'bob@example.com', password: 'wrong-password' },
      });
      expect(loginResponse.statusCode).toBe(401);
    });

    it('rotates refresh tokens on a normal refresh', async () => {
      const { cookie: firstCookie } = await register(
        'carol@example.com',
        'Carol',
      );

      const refreshResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: firstCookie },
      });
      expect(refreshResponse.statusCode).toBe(201);
    });

    it(
      'within the reuse grace window, replaying an already-rotated token ' +
        'issues a sibling instead of revoking the family (two tabs refreshing at once)',
      async () => {
        const { cookie: firstCookie } = await register(
          'dana@example.com',
          'Dana',
        );

        const refreshResponse = await app.inject({
          method: 'POST',
          url: '/api/auth/refresh',
          headers: { cookie: firstCookie },
        });
        expect(refreshResponse.statusCode).toBe(201);
        const secondCookie = cookieHeaderFrom(
          refreshResponse.cookies.map((c) => `${c.name}=${c.value}`),
        );

        // A second tab presenting the same (already-rotated) first token
        // within the grace window gets a fresh sibling token, not a 401.
        const siblingResponse = await app.inject({
          method: 'POST',
          url: '/api/auth/refresh',
          headers: { cookie: firstCookie },
        });
        expect(siblingResponse.statusCode).toBe(201);

        // The other tab's token (from the normal rotation above) must still work too.
        const secondStillWorksResponse = await app.inject({
          method: 'POST',
          url: '/api/auth/refresh',
          headers: { cookie: secondCookie },
        });
        expect(secondStillWorksResponse.statusCode).toBe(201);
      },
    );

    it('revokes the whole family when an old (backdated) refresh token is replayed', async () => {
      const { cookie: firstCookie } = await register(
        'erin@example.com',
        'Erin',
      );
      const firstTokenId = firstCookie.match(/refresh_token=([^.;]+)\./)?.[1];
      expect(firstTokenId).toBeTruthy();

      const refreshResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: firstCookie },
      });
      const secondCookie = cookieHeaderFrom(
        refreshResponse.cookies.map((c) => `${c.name}=${c.value}`),
      );

      // Backdate revoked_at past the 30s grace window to simulate a stale,
      // genuinely-stolen replay rather than a concurrent legitimate tab.
      const database = app.get(
        (await import('../src/common/database/database.service.js'))
          .DatabaseService,
      );
      database.db
        .prepare(`UPDATE refresh_tokens SET revoked_at = ? WHERE id = ?`)
        .run(new Date(Date.now() - 60_000).toISOString(), firstTokenId);

      const reuseResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: firstCookie },
      });
      expect(reuseResponse.statusCode).toBe(401);

      const afterReuseResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie: secondCookie },
      });
      expect(afterReuseResponse.statusCode).toBe(401);
    });

    it('logout revokes the whole refresh token family', async () => {
      const { cookie } = await register('frank@example.com', 'Frank');

      const logoutResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie },
      });
      expect(logoutResponse.statusCode).toBe(201);

      const refreshAfterLogoutResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: { cookie },
      });
      expect(refreshAfterLogoutResponse.statusCode).toBe(401);
    });

    it('accepts a matching Origin and rejects a foreign one on a mutating request', async () => {
      const { cookie } = await register('origin@example.com', 'Origin Test');

      const matching = await app.inject({
        method: 'POST',
        url: '/api/profiles',
        headers: {
          cookie,
          host: 'localhost:3000',
          origin: 'http://localhost:3000',
        },
        payload: { displayName: 'Matching Origin' },
      });
      expect(matching.statusCode).toBe(201);

      const foreign = await app.inject({
        method: 'POST',
        url: '/api/profiles',
        headers: {
          cookie,
          host: 'localhost:3000',
          origin: 'http://evil.test',
        },
        payload: { displayName: 'Foreign Origin' },
      });
      expect(foreign.statusCode).toBe(403);
    });

    it("returns 403/404 when accessing another user's project", async () => {
      const alice = await register('alice2@example.com', 'Alice');
      const bob = await register('bob2@example.com', 'Bob');

      const profileResponse = await app.inject({
        method: 'POST',
        url: '/api/profiles',
        headers: { cookie: alice.cookie },
        payload: { displayName: 'Alice Workspace' },
      });
      const profile = JSON.parse(profileResponse.payload);

      const projectResponse = await app.inject({
        method: 'POST',
        url: '/api/projects',
        headers: { cookie: alice.cookie },
        payload: { name: 'Alice Project', ownerProfileId: profile.id },
      });
      const project = JSON.parse(projectResponse.payload);

      const bobAccessResponse = await app.inject({
        method: 'GET',
        url: `/api/projects/${project.id}`,
        headers: { cookie: bob.cookie },
      });
      expect(bobAccessResponse.statusCode).toBe(403);

      const bobProfilesResponse = await app.inject({
        method: 'GET',
        url: '/api/profiles',
        headers: { cookie: bob.cookie },
      });
      expect(JSON.parse(bobProfilesResponse.payload)).toEqual([]);
    });
  });

  afterEach(async () => {
    await app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
});
