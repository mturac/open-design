import { describe, expect, it } from 'vitest';

import {
  resolveHtmlArtifactFileName,
  rewriteHtmlLinksToCurrentProjectFiles,
} from '../../src/artifacts/html-links';

describe('resolveHtmlArtifactFileName', () => {
  it('keeps index.html as the stable entry point when the saved artifact already owns it', () => {
    expect(
      resolveHtmlArtifactFileName({
        baseName: 'index',
        ext: '.html',
        existingFileNames: new Set(['index.html']),
        savedArtifactName: 'index.html',
      }),
    ).toBe('index.html');
  });

  it('uses a suffix for index.html when the existing file is unrelated', () => {
    expect(
      resolveHtmlArtifactFileName({
        baseName: 'index',
        ext: '.html',
        existingFileNames: new Set(['index.html']),
      }),
    ).toBe('index-2.html');
  });

  it('keeps numbered collision names for non-entry html artifacts', () => {
    expect(
      resolveHtmlArtifactFileName({
        baseName: 'about',
        ext: '.html',
        existingFileNames: new Set(['about.html', 'about-2.html']),
      }),
    ).toBe('about-3.html');
  });
});

describe('rewriteHtmlLinksToCurrentProjectFiles', () => {
  it('rewrites relative html links to the newest matching project file', () => {
    const html =
      '<!doctype html><html><body>' +
      '<a href="about.html">About</a>' +
      '<a href="contact.html?tab=team#lead">Contact</a>' +
      '<a href="#local">Local</a>' +
      '<a href="https://example.com/about.html">External</a>' +
      '</body></html>';

    const out = rewriteHtmlLinksToCurrentProjectFiles(html, [
      htmlFile('about.html', 10),
      htmlFile('about-2.html', 30),
      htmlFile('contact.html', 20),
      htmlFile('contact-2.html', 40),
    ]);

    expect(out).toContain('href="about-2.html"');
    expect(out).toContain('href="contact-2.html?tab=team#lead"');
    expect(out).toContain('href="#local"');
    expect(out).toContain('href="https://example.com/about.html"');
  });
});

function htmlFile(name: string, mtime: number) {
  return {
    name,
    kind: 'html',
    mime: 'text/html',
    size: 1,
    mtime,
  };
}
