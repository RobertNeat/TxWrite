import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { User } from './auth.types.js';

interface AuthResponse {
  user: User;
  accessTokenExpiresAt: string;
}

/** Tri-state so a transient network/5xx error (e.g. dev-proxy mid-rebuild) isn't treated as logout. */
type RefreshResult = 'ok' | 'unauthenticated' | 'transient-error';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);
  readonly currentUser = signal<User | null>(null);
  readonly isAuthenticated = signal(false);
  /** Resolves once the initial /auth/me session-restore check has completed. */
  readonly ready: Promise<void>;

  private refreshInFlight: Promise<RefreshResult> | null = null;
  private proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.ready = this.restoreSession();
  }

  private async restoreSession(): Promise<void> {
    try {
      let response = await fetch('/api/auth/me');
      if (response.status === 401) {
        // The access-token cookie (15 min TTL) has very likely expired by
        // the time the user reopens the tab; the 30-day refresh token is
        // still good, so refresh once before giving up on the session.
        const result = await this.refreshOnce();
        if (result !== 'ok') return;
        response = await fetch('/api/auth/me');
      }
      if (response.ok) {
        const body = (await response.json()) as AuthResponse;
        this.currentUser.set(body.user);
        this.isAuthenticated.set(true);
        this.scheduleProactiveRefresh(body.accessTokenExpiresAt);
      }
    } catch {
      // network error on startup — treat as logged out, UI will prompt login
    }
  }

  /**
   * Plain <a download> links (ZIP export, workspace export) navigate the
   * browser directly and can't retry on a 401 the way fetch() can — so the
   * access-token cookie is refreshed on a timer anchored to its actual
   * server-issued expiry, keeping those links usable without each one
   * needing its own pre-check.
   */
  private scheduleProactiveRefresh(accessTokenExpiresAt: string): void {
    if (this.proactiveRefreshTimer) {
      clearTimeout(this.proactiveRefreshTimer);
    }
    const margin = 60_000;
    const delay = Math.max(5_000, new Date(accessTokenExpiresAt).getTime() - Date.now() - margin);
    this.proactiveRefreshTimer = setTimeout(() => {
      if (this.isAuthenticated()) {
        void this.refreshOnce();
      }
    }, delay);
  }

  async register(email: string, password: string, displayName: string): Promise<User> {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName }),
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }
    const body = (await response.json()) as AuthResponse;
    this.currentUser.set(body.user);
    this.isAuthenticated.set(true);
    this.scheduleProactiveRefresh(body.accessTokenExpiresAt);
    return body.user;
  }

  async login(email: string, password: string): Promise<User> {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }
    const body = (await response.json()) as AuthResponse;
    this.currentUser.set(body.user);
    this.isAuthenticated.set(true);
    this.scheduleProactiveRefresh(body.accessTokenExpiresAt);
    return body.user;
  }

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    this.currentUser.set(null);
    this.isAuthenticated.set(false);
    if (this.proactiveRefreshTimer) {
      clearTimeout(this.proactiveRefreshTimer);
      this.proactiveRefreshTimer = null;
    }
  }

  /**
   * Rotates the refresh token exactly once even when multiple requests 401
   * concurrently — with reuse-detection on the backend, two parallel rotations
   * of the same refresh token would revoke the user's own session. Returns
   * true only on a definitive 'ok'; callers that just need a boolean (the
   * ApiService 401-retry path, SSE reconnect) treat anything else as "can't
   * proceed right now" without necessarily being logged out.
   */
  async refreshOnce(): Promise<RefreshResult> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.doRefresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async doRefresh(): Promise<RefreshResult> {
    try {
      const response = await fetch('/api/auth/refresh', { method: 'POST' });
      if (response.status === 401) {
        // Only a definitive "no/expired/reused refresh token" from the
        // server means the session is actually over — a 5xx or network
        // error (e.g. the backend mid-restart behind the dev proxy) must
        // not log the user out.
        this.currentUser.set(null);
        this.isAuthenticated.set(false);
        // Without this, a session that lapses while the user is in the
        // editor (projects/:id) leaves them stranded there with every save
        // failing silently instead of being sent back to log in.
        void this.router.navigateByUrl('/');
        return 'unauthenticated';
      }
      if (!response.ok) {
        return 'transient-error';
      }
      const body = (await response.json()) as { accessTokenExpiresAt: string };
      this.scheduleProactiveRefresh(body.accessTokenExpiresAt);
      return 'ok';
    } catch {
      return 'transient-error';
    }
  }

  /** Maps known backend outcomes to Polish; everything else (validation details) is shown as-is since it's already user-facing text, just untranslated. */
  private async errorMessage(response: Response): Promise<string> {
    if (response.status === 401) {
      return 'Nieprawidłowy adres e-mail lub hasło.';
    }
    if (response.status === 409) {
      return 'Konto z tym adresem e-mail już istnieje.';
    }
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) {
        return body.message.join(', ');
      }
      return body.message ?? `Żądanie nie powiodło się (${response.status}).`;
    } catch {
      return `Żądanie nie powiodło się (${response.status}).`;
    }
  }
}
