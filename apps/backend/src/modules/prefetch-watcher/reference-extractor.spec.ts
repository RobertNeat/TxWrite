import { extractReferences } from './reference-extractor.js';

describe('extractReferences', () => {
  it('extracts \\usepackage names as .sty files', () => {
    const { files } = extractReferences(
      '\\usepackage{tikz}\\usepackage{amsmath}',
    );
    expect(files).toEqual(['tikz.sty', 'amsmath.sty']);
  });

  it('extracts comma-separated and bracketed-option \\usepackage', () => {
    const { files } = extractReferences(
      '\\usepackage[utf8]{inputenc, fontenc}',
    );
    expect(files).toEqual(['inputenc.sty', 'fontenc.sty']);
  });

  it('extracts \\RequirePackage the same as \\usepackage', () => {
    const { files } = extractReferences('\\RequirePackage{xcolor}');
    expect(files).toEqual(['xcolor.sty']);
  });

  it('extracts \\documentclass as a .cls file', () => {
    const { files } = extractReferences('\\documentclass[12pt]{article}');
    expect(files).toEqual(['article.cls']);
  });

  it("extracts \\usetikzlibrary as tikz's own *.code.tex naming", () => {
    const { files } = extractReferences('\\usetikzlibrary{cd,arrows}');
    expect(files).toEqual([
      'tikzlibrarycd.code.tex',
      'tikzlibraryarrows.code.tex',
    ]);
  });

  it('extracts font commands separately from file references', () => {
    const { files, fonts } = extractReferences(
      '\\setmainfont{Inter}\\usepackage{tikz}',
    );
    expect(fonts).toEqual(['Inter']);
    expect(files).toEqual(['tikz.sty']);
  });

  it('ignores a commented-out \\usepackage', () => {
    const { files } = extractReferences(
      '% \\usepackage{tikz}\nNo package here.',
    );
    expect(files).toEqual([]);
  });

  it('does not treat an escaped percent as a comment', () => {
    const { files } = extractReferences('100\\% \\usepackage{tikz}');
    expect(files).toEqual(['tikz.sty']);
  });

  it('deduplicates repeated references', () => {
    const { files } = extractReferences(
      '\\usepackage{tikz}\n\\usepackage{tikz}',
    );
    expect(files).toEqual(['tikz.sty']);
  });

  it('returns empty arrays for content with no references', () => {
    expect(extractReferences('Just plain text.')).toEqual({
      files: [],
      fonts: [],
    });
  });
});
