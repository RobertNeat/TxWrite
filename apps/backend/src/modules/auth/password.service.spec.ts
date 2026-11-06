import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes and verifies a correct password', async () => {
    const hash = await service.hash('correct-password-123');
    expect(await service.verify('correct-password-123', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('correct-password-123');
    expect(await service.verify('wrong-password', hash)).toBe(false);
  });

  it('produces a self-describing scrypt hash format', async () => {
    const hash = await service.hash('correct-password-123');
    expect(hash.split('$')).toHaveLength(6);
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('rejects a malformed stored hash instead of throwing', async () => {
    expect(await service.verify('anything', 'not-a-valid-hash')).toBe(false);
  });
});
