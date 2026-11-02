import { isValidEngine, isValidMainFile } from './compile-validation.js';

describe('isValidMainFile', () => {
  it('accepts a plain .tex filename', () => {
    expect(isValidMainFile('main.tex')).toBe(true);
  });

  it('accepts a plain .md filename', () => {
    expect(isValidMainFile('main.md')).toBe(true);
  });

  it('accepts a nested relative path', () => {
    expect(isValidMainFile('chapters/main.tex')).toBe(true);
  });

  it('rejects a path with ..', () => {
    expect(isValidMainFile('../outside.tex')).toBe(false);
  });

  it('rejects an absolute path', () => {
    expect(isValidMainFile('/etc/passwd.tex')).toBe(false);
  });

  it('rejects a value starting with a dash (option injection)', () => {
    expect(isValidMainFile('-pdflatex=touch /tmp/pwned %S.tex')).toBe(false);
  });

  it('rejects an unsupported extension', () => {
    expect(isValidMainFile('main.docx')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidMainFile('')).toBe(false);
  });
});

describe('isValidEngine', () => {
  it.each(['pdflatex', 'xelatex', 'lualatex'])('accepts %s', (engine) => {
    expect(isValidEngine(engine)).toBe(true);
  });

  it('rejects an unknown engine', () => {
    expect(isValidEngine('sh')).toBe(false);
  });

  it('rejects an engine string with shell metacharacters', () => {
    expect(isValidEngine('pdflatex; rm -rf /')).toBe(false);
  });
});
