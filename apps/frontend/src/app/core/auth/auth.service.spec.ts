import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const USER = {
  id: 'user-1',
  email: 'alice@example.com',
  displayName: 'Alice',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const FAR_FUTURE_EXPIRY = new Date(Date.now() + 10 * 60_000).toISOString();

describe('AuthService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function createService(): { service: AuthService; router: Router } {
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    const service = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    return { service, router };
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('restoreSession (session survives a page reload)', () => {
    it('restores the session when /auth/me succeeds on the first try', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: USER, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      );
      const { service } = createService();
      await service.ready;

      expect(service.isAuthenticated()).toBe(true);
      expect(service.currentUser()).toEqual(USER);
      expect(fetchMock).toHaveBeenCalledWith('/api/auth/me');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refreshes once and retries /auth/me when the access token has expired', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { message: 'Not authenticated' })) // first /me
        .mockResolvedValueOnce(jsonResponse(201, { accessTokenExpiresAt: FAR_FUTURE_EXPIRY })) // refresh
        .mockResolvedValueOnce(
          jsonResponse(200, { user: USER, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
        ); // retried /me

      const { service } = createService();
      await service.ready;

      expect(service.isAuthenticated()).toBe(true);
      expect(service.currentUser()).toEqual(USER);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh');
    });

    it('stays logged out when refresh itself returns 401 (no valid refresh token)', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { message: 'Not authenticated' })) // /me
        .mockResolvedValueOnce(jsonResponse(401, { message: 'No refresh token' })); // refresh

      const { service } = createService();
      await service.ready;

      expect(service.isAuthenticated()).toBe(false);
      expect(service.currentUser()).toBeNull();
      // Must not retry /me a second time after a definitive refresh failure.
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('stays logged out (not a crash) on a network error during restore', async () => {
      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { service } = createService();
      await expect(service.ready).resolves.toBeUndefined();
      expect(service.isAuthenticated()).toBe(false);
    });
  });

  describe('refreshOnce (tri-state outcome)', () => {
    it('does not log the user out on a transient 5xx error', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: USER, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      );
      const { service } = createService();
      await service.ready;
      expect(service.isAuthenticated()).toBe(true);

      fetchMock.mockResolvedValueOnce(jsonResponse(502, { message: 'Bad Gateway' }));
      const result = await service.refreshOnce();

      expect(result).toBe('transient-error');
      // A transient error must not clear the session the user already had.
      expect(service.isAuthenticated()).toBe(true);
    });

    it('does not log the user out on a network error', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: USER, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      );
      const { service } = createService();
      await service.ready;

      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const result = await service.refreshOnce();

      expect(result).toBe('transient-error');
      expect(service.isAuthenticated()).toBe(true);
    });

    it('logs the user out and navigates home only on a definitive 401', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: USER, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      );
      const { service, router } = createService();
      await service.ready;
      const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

      fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'No refresh token' }));
      const result = await service.refreshOnce();

      expect(result).toBe('unauthenticated');
      expect(service.isAuthenticated()).toBe(false);
      expect(service.currentUser()).toBeNull();
      expect(navigateSpy).toHaveBeenCalledWith('/');
    });

    it('coalesces concurrent calls into a single in-flight refresh request', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: USER, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      );
      const { service } = createService();
      await service.ready;

      let resolveRefresh!: (value: Response) => void;
      fetchMock.mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
          }),
      );

      const first = service.refreshOnce();
      const second = service.refreshOnce();
      resolveRefresh(jsonResponse(201, { accessTokenExpiresAt: FAR_FUTURE_EXPIRY }));

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult).toBe('ok');
      expect(secondResult).toBe('ok');
      // Exactly one network call for /auth/refresh despite two callers —
      // calling it twice would trigger the backend's reuse-detection on a
      // genuinely concurrent (not just coalesced) refresh token rotation.
      const refreshCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh');
      expect(refreshCalls).toHaveLength(1);
    });
  });

  describe('register / login / logout', () => {
    it('register() sets the authenticated user on success', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: null, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      ); // restoreSession: not logged in
      const { service } = createService();
      await service.ready;

      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, { user: USER, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      );
      const user = await service.register('alice@example.com', 'correct-password-123', 'Alice');

      expect(user).toEqual(USER);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.currentUser()).toEqual(USER);
    });

    it('register() throws a Polish message and does not authenticate on a 409 (duplicate email)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
      const { service } = createService();
      await service.ready;

      fetchMock.mockResolvedValueOnce(jsonResponse(409, { message: 'Email already registered' }));
      await expect(
        service.register('alice@example.com', 'correct-password-123', 'Alice'),
      ).rejects.toThrow('Konto z tym adresem e-mail już istnieje.');
      expect(service.isAuthenticated()).toBe(false);
    });

    it('login() throws a Polish message and does not authenticate on a 401 (wrong credentials)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(401, {}));
      const { service } = createService();
      await service.ready;

      fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Invalid email or password' }));
      await expect(service.login('alice@example.com', 'wrong-password')).rejects.toThrow(
        'Nieprawidłowy adres e-mail lub hasło.',
      );
      expect(service.isAuthenticated()).toBe(false);
    });

    it('logout() clears the session even if the request fails', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: USER, accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      );
      const { service } = createService();
      await service.ready;
      expect(service.isAuthenticated()).toBe(true);

      fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      await service.logout();

      expect(service.isAuthenticated()).toBe(false);
      expect(service.currentUser()).toBeNull();
    });
  });

  describe('proactive refresh scheduling', () => {
    it('schedules a refresh before the server-issued access-token expiry, not a hardcoded guess', async () => {
      vi.useFakeTimers();
      const soonExpiry = new Date(Date.now() + 65_000).toISOString(); // 65s out, 60s margin => ~5s delay
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: USER, accessTokenExpiresAt: soonExpiry }),
      );
      const { service } = createService();
      await service.ready;

      fetchMock.mockResolvedValueOnce(
        jsonResponse(201, { accessTokenExpiresAt: FAR_FUTURE_EXPIRY }),
      );
      await vi.advanceTimersByTimeAsync(6_000);

      const refreshCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh');
      expect(refreshCalls).toHaveLength(1);
    });
  });
});
