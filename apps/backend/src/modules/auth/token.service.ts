import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database/database.service.js';

export interface AccessTokenSignPayload {
  sub: string;
}

/** What verify() returns: the signed payload plus the standard `exp`/`iat` claims @nestjs/jwt adds. */
export interface AccessTokenPayload extends AccessTokenSignPayload {
  exp: number;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  family_id: string;
  revoked_at: string | null;
  replaced_by_id: string | null;
  expires_at: string;
}

// Two tabs (or a tab plus a resumed service worker) can both present the
// same still-valid refresh token within milliseconds of each other — e.g. on
// wake from sleep. Without a grace window, the second request would look
// identical to a stolen+replayed token and revoke the whole family, logging
// the user out everywhere. Within this window, a reuse re-issues from the
// replacement token's family instead of revoking.
const REUSE_GRACE_WINDOW_MS = 30_000;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Provider-agnostic issuance: local login and future OIDC callbacks (Google,
 * Keycloak) both end up calling issueFor(userId) — neither needs to know how
 * the user authenticated.
 */
@Injectable()
export class TokenService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlDays: number;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
  ) {
    this.accessTtlSeconds = Number(
      this.config.get<string>('JWT_ACCESS_TTL_SECONDS', '900'),
    );
    this.refreshTtlDays = Number(
      this.config.get<string>('JWT_REFRESH_TTL_DAYS', '30'),
    );
  }

  private signAccessToken(userId: string): {
    token: string;
    expiresAt: Date;
  } {
    const token = this.jwt.sign(
      { sub: userId } satisfies AccessTokenSignPayload,
      {
        expiresIn: this.accessTtlSeconds,
        algorithm: 'HS256',
      },
    );
    return {
      token,
      expiresAt: new Date(Date.now() + this.accessTtlSeconds * 1000),
    };
  }

  private issueRefreshToken(userId: string, familyId: string): IssuedTokens {
    const rawToken = randomBytes(32).toString('base64url');
    const id = randomUUID();
    const expiresAt = new Date(
      Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000,
    );
    this.database.db
      .prepare(
        `INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, userId, hashToken(rawToken), familyId, expiresAt.toISOString());

    const access = this.signAccessToken(userId);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: `${id}.${rawToken}`,
      refreshTokenExpiresAt: expiresAt,
    };
  }

  /** Issues a brand-new session (new token family) — used at login/register. */
  issueFor(userId: string): IssuedTokens {
    return this.issueRefreshToken(userId, randomUUID());
  }

  verifyAccessToken(token: string): AccessTokenPayload {
    return this.jwt.verify<AccessTokenPayload>(token, {
      algorithms: ['HS256'],
    });
  }

  /**
   * Rotates a refresh token. If the presented token was already
   * used/revoked, the entire token family is revoked (reuse-detection: a
   * stolen+replayed refresh token after the legitimate client already
   * rotated it signals theft).
   */
  rotate(presentedToken: string): IssuedTokens {
    const [id, rawToken] = presentedToken.split('.', 2);
    if (!id || !rawToken) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const row = this.database.db
      .prepare('SELECT * FROM refresh_tokens WHERE id = ?')
      .get(id) as unknown as RefreshTokenRow | undefined;

    if (!row || row.token_hash !== hashToken(rawToken)) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }
    if (row.revoked_at) {
      const revokedAgoMs = Date.now() - new Date(row.revoked_at).getTime();
      if (revokedAgoMs <= REUSE_GRACE_WINDOW_MS && row.replaced_by_id) {
        const replacement = this.database.db
          .prepare('SELECT * FROM refresh_tokens WHERE id = ?')
          .get(row.replaced_by_id) as unknown as RefreshTokenRow | undefined;
        // Still-unrevoked replacement means the legitimate client (the other
        // tab) already rotated — issue a sibling in the same family rather
        // than treating this as theft. Both tabs' Set-Cookie race for the
        // browser's one cookie jar; whichever response lands last wins, and
        // the loser is simply orphaned (still valid until its own expiry).
        if (replacement && !replacement.revoked_at) {
          return this.issueRefreshToken(row.user_id, row.family_id);
        }
      }
      this.revokeFamily(row.family_id);
      throw new UnauthorizedException('Refresh token already used');
    }

    const next = this.issueRefreshToken(row.user_id, row.family_id);
    const [nextId] = next.refreshToken.split('.', 2);
    this.database.db
      .prepare(
        `UPDATE refresh_tokens SET revoked_at = ?, replaced_by_id = ? WHERE id = ?`,
      )
      .run(new Date().toISOString(), nextId, id);
    return next;
  }

  revokeFamily(familyId: string): void {
    this.database.db
      .prepare(
        `UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL`,
      )
      .run(new Date().toISOString(), familyId);
  }

  /** Logout revokes the whole family, not just the presented token, so a sibling issued under the reuse grace window above doesn't outlive logout. */
  revokeToken(presentedToken: string): void {
    const [id, rawToken] = presentedToken.split('.', 2);
    if (!id || !rawToken) return;
    const row = this.database.db
      .prepare('SELECT * FROM refresh_tokens WHERE id = ?')
      .get(id) as unknown as RefreshTokenRow | undefined;
    if (!row || row.token_hash !== hashToken(rawToken)) return;
    this.revokeFamily(row.family_id);
  }
}
