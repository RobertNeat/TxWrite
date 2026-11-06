import { TestBed } from '@angular/core/testing';
import { provideRouter, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';

function invokeGuard(): Promise<boolean | UrlTree> {
  return Promise.resolve(
    TestBed.runInInjectionContext(() => authGuard(null as never, null as never)),
  ) as Promise<boolean | UrlTree>;
}

describe('authGuard', () => {
  let authServiceStub: { ready: Promise<void>; isAuthenticated: () => boolean };

  function configure(isAuthenticated: boolean): void {
    authServiceStub = {
      ready: Promise.resolve(),
      isAuthenticated: () => isAuthenticated,
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceStub }],
    });
  }

  it('allows navigation once session restore has resolved and the user is authenticated', async () => {
    configure(true);
    const result = await invokeGuard();
    expect(result).toBe(true);
  });

  it('redirects to / when session restore resolves with no authenticated user', async () => {
    configure(false);
    const result = await invokeGuard();
    expect(result).toBeInstanceOf(UrlTree);
  });

  it('waits for auth.ready before deciding — does not bounce a logged-in user mid-restore', async () => {
    let resolveReady!: () => void;
    authServiceStub = {
      ready: new Promise((resolve) => {
        resolveReady = resolve;
      }),
      isAuthenticated: () => true,
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: authServiceStub }],
    });

    const resultPromise = invokeGuard();
    let settled = false;
    void resultPromise.then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false); // must not resolve before `ready` does

    resolveReady();
    const result = await resultPromise;
    expect(result).toBe(true);
  });
});
