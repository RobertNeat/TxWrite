import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP-recommended scrypt parameters; N=2^17 needs ~128 MiB, well over
// Node's default 32 MiB scrypt maxmem, so it must be passed explicitly.
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

@Injectable()
export class PasswordService {
  /** Self-describing format so parameters can be upgraded later without breaking old hashes. */
  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await scryptAsync(password, salt);
    return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derivedKey.toString('base64')}`;
  }

  async verify(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const [, nStr, rStr, pStr, saltB64, hashB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derivedKey = await new Promise<Buffer>((resolve, reject) => {
      scrypt(
        password,
        salt,
        expected.length,
        {
          N: Number(nStr),
          r: Number(rStr),
          p: Number(pStr),
          maxmem: SCRYPT_MAXMEM,
        },
        (error, derivedKeyResult) => {
          if (error) reject(error);
          else resolve(derivedKeyResult);
        },
      );
    });
    return (
      derivedKey.length === expected.length &&
      timingSafeEqual(derivedKey, expected)
    );
  }

  /** Hashes a dummy password so login timing doesn't reveal whether an email exists. */
  async hashDummy(): Promise<void> {
    await this.hash('dummy-password-for-constant-time-login');
  }
}
