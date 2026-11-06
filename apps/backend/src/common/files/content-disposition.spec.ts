import { describe, expect, it } from 'vitest';
import { attachmentDisposition } from './content-disposition.js';

describe('attachmentDisposition', () => {
  it('includes an ASCII fallback and a UTF-8 filename* form', () => {
    const header = attachmentDisposition('main', 'pdf');
    expect(header).toBe(
      `attachment; filename="main.pdf"; filename*=UTF-8''main.pdf`,
    );
  });

  it('replaces non-ASCII characters in the fallback but keeps them percent-encoded in filename*', () => {
    const header = attachmentDisposition('Praca-żółw', 'zip');
    expect(header).toContain('filename="Praca-___w.zip"');
    expect(header).toContain(`filename*=UTF-8''Praca-%C5%BC%C3%B3%C5%82w.zip`);
  });
});
