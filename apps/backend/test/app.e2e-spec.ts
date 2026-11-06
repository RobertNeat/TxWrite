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

/** Parses `Set-Cookie` response headers into a single `Cookie` request header value. */
function cookieHeaderFrom(setCookieHeaders: string[] | undefined): string {
  return (setCookieHeaders ?? [])
    .map((header) => header.split(';')[0])
    .join('; ');
}

describe('AppController (e2e)', () => {
  let app: NestFastifyApplication;
  let dataDir: string;

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
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
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
    async function register(email: string, displayName: string) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email, password: 'correct-password-123', displayName },
      });
      return {
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

    it('registers, sets cookies, and allows /auth/me with them', async () => {
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
      const cookie = cookieHeaderFrom(
        registerResponse.cookies.map((c) => `${c.name}=${c.value}`),
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
      const registerResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'carol@example.com',
          password: 'correct-password-123',
          displayName: 'Carol',
        },
      });
      const firstCookie = cookieHeaderFrom(
        registerResponse.cookies.map((c) => `${c.name}=${c.value}`),
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
        const registerResponse = await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          payload: {
            email: 'dana@example.com',
            password: 'correct-password-123',
            displayName: 'Dana',
          },
        });
        const firstCookie = cookieHeaderFrom(
          registerResponse.cookies.map((c) => `${c.name}=${c.value}`),
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
      const registerResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'erin@example.com',
          password: 'correct-password-123',
          displayName: 'Erin',
        },
      });
      const firstCookie = cookieHeaderFrom(
        registerResponse.cookies.map((c) => `${c.name}=${c.value}`),
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
      const registerResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'frank@example.com',
          password: 'correct-password-123',
          displayName: 'Frank',
        },
      });
      const cookie = cookieHeaderFrom(
        registerResponse.cookies.map((c) => `${c.name}=${c.value}`),
      );

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
