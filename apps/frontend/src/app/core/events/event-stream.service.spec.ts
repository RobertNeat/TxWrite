import { TestBed } from '@angular/core/testing';
import { EventStreamService } from './event-stream.service.js';
import { AuthService } from '../auth/auth.service.js';

/** Minimal EventSource stub: captures handlers and lets the test fire them manually. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

function jsonResponse(status: number): Response {
  return new Response('{}', { status });
}

describe('EventStreamService (SSE reconnect)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let refreshOnceMock: ReturnType<typeof vi.fn>;
  let service: EventStreamService;

  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    refreshOnceMock = vi.fn();
    vi.useFakeTimers();

    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: { refreshOnce: refreshOnceMock } }],
    });
    service = TestBed.inject(EventStreamService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('connects and marks connected on open', () => {
    service.connect();
    expect(FakeEventSource.instances).toHaveLength(1);
    FakeEventSource.instances[0].onopen?.();
    expect(service.connected()).toBe(true);
  });

  it('on error, probes /me, refreshes once on a confirmed 401, then reconnects', async () => {
    service.connect();
    const first = FakeEventSource.instances[0];
    fetchMock.mockResolvedValueOnce(jsonResponse(401)); // /auth/me probe
    refreshOnceMock.mockResolvedValueOnce('ok');

    first.onerror?.();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(first.closed).toBe(true);
    expect(refreshOnceMock).toHaveBeenCalledTimes(1);
    // A fresh EventSource was opened for the reconnect.
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('on error with a healthy session (non-401 /me), reconnects without calling refresh', async () => {
    service.connect();
    const first = FakeEventSource.instances[0];
    fetchMock.mockResolvedValueOnce(jsonResponse(200)); // /auth/me probe: still fine

    first.onerror?.();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(refreshOnceMock).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('stops reconnecting once refresh definitively confirms the session is over', async () => {
    service.connect();
    const first = FakeEventSource.instances[0];
    fetchMock.mockResolvedValueOnce(jsonResponse(401));
    refreshOnceMock.mockResolvedValueOnce('unauthenticated');

    first.onerror?.();
    await vi.advanceTimersByTimeAsync(2_000);

    // No new EventSource should have been opened — reconnecting after a
    // confirmed logout would just loop forever hitting 401s.
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('backs off exponentially (capped) across repeated errors, like plain EventSource used to before auth existed', async () => {
    service.connect();
    fetchMock.mockResolvedValue(jsonResponse(200)); // always healthy — pure network blips

    // First error: ~1s delay.
    FakeEventSource.instances[0].onerror?.();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeEventSource.instances).toHaveLength(2);

    // Second error: delay should have doubled (~2s), not stayed at 1s.
    const before = FakeEventSource.instances.length;
    FakeEventSource.instances[1].onerror?.();
    await vi.advanceTimersByTimeAsync(1_500);
    expect(FakeEventSource.instances.length).toBe(before); // not yet reconnected at 1.5s
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances.length).toBe(before + 1); // reconnected by ~2.5s total
  });

  it('ngOnDestroy stops further reconnect attempts', async () => {
    service.connect();
    const first = FakeEventSource.instances[0];
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    first.onerror?.();
    service.ngOnDestroy();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(FakeEventSource.instances).toHaveLength(1);
  });
});
