import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ApiService } from './api.service.js';
import { AuthService } from '../auth/auth.service.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('ApiService (401-retry on access-token expiry)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let refreshOnceMock: ReturnType<typeof vi.fn>;
  let service: ApiService;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    refreshOnceMock = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: { refreshOnce: refreshOnceMock, ready: Promise.resolve() },
        },
      ],
    });
    service = TestBed.inject(ApiService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries the request once after a successful refresh on 401', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Not authenticated' }))
      .mockResolvedValueOnce(
        jsonResponse(200, [{ id: 'p1', displayName: 'Profile', createdAt: 'x' }]),
      );
    refreshOnceMock.mockResolvedValueOnce('ok');

    const result = await service.listProfiles();

    expect(result).toEqual([{ id: 'p1', displayName: 'Profile', createdAt: 'x' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshOnceMock).toHaveBeenCalledTimes(1);
  });

  it('does not retry (and surfaces the error) when refresh fails to recover the session', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { message: 'Not authenticated' }));
    refreshOnceMock.mockResolvedValueOnce('unauthenticated');

    await expect(service.listProfiles()).rejects.toThrow(/401/);
    // Only the original request — no pointless retry once refresh gave up.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call refresh at all on a non-401 error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: 'Internal Server Error' }));

    await expect(service.listProfiles()).rejects.toThrow(/500/);
    expect(refreshOnceMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('passes a 200 response straight through without touching refresh', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, []));

    await service.listProfiles();

    expect(refreshOnceMock).not.toHaveBeenCalled();
  });

  it('applies the same refresh-retry behavior to file read/write (fetchWithRefresh path)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(new Response('file contents', { status: 200 }));
    refreshOnceMock.mockResolvedValueOnce('ok');

    const content = await service.readFile('proj-1', 'main.tex');

    expect(content).toBe('file contents');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
