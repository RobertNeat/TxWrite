import { mimeTypeFor } from './projects.controller.js';

describe('mimeTypeFor', () => {
  it('maps known image/pdf extensions to their mime type', () => {
    expect(mimeTypeFor('image.png')).toBe('image/png');
    expect(mimeTypeFor('photo.JPG')).toBe('image/jpeg');
    expect(mimeTypeFor('photo.jpeg')).toBe('image/jpeg');
    expect(mimeTypeFor('diagram.svg')).toBe('image/svg+xml');
    expect(mimeTypeFor('report.pdf')).toBe('application/pdf');
  });

  it('matches by extension regardless of directory depth', () => {
    expect(mimeTypeFor('obrazy/sub/dir/image.png')).toBe('image/png');
  });

  it('falls back to application/octet-stream for text and unknown extensions', () => {
    expect(mimeTypeFor('main.tex')).toBe('application/octet-stream');
    expect(mimeTypeFor('notes.md')).toBe('application/octet-stream');
    expect(mimeTypeFor('noext')).toBe('application/octet-stream');
  });
});
