import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildBatchArchive,
  buildProjectArchive,
  listFiles,
  listProjectFolders,
} from '../src/projects.js';

// Regression tests for #6175: the file/folder listing helpers used a blanket
// `startsWith('.')` filter, so legitimate dot-prefixed user content
// (.github/, .storybook/, .notes.md) never appeared in @-mention autocomplete or
// project search. The intended policy is the explicit ignore list in
// project-ignored-dirs.ts (.git, .od, node_modules, ...), not "every dotfile".
//
// Imported folders (metadata.baseDir) are the exception: hidden path segments
// there are blocked from read/write/delete by assertVisibleForImportedProject
// to keep credential dotfiles (.ssh, .aws) out of reach, so the listing must
// stay consistent and keep hiding them — suggesting a path the file API then
// refuses to serve would be worse than not suggesting it.

async function seedProjectTree(root: string): Promise<void> {
  await mkdir(path.join(root, '.github', 'workflows'), { recursive: true });
  await writeFile(path.join(root, '.github', 'workflows', 'ci.yml'), 'on: push');
  await mkdir(path.join(root, '.storybook'));
  await writeFile(path.join(root, '.storybook', 'main.ts'), '{}');
  await writeFile(path.join(root, '.notes.md'), '# notes');
  await writeFile(path.join(root, 'index.html'), '<!doctype html>');
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'app.ts'), 'export {}');
  await mkdir(path.join(root, '.git'));
  await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main');
  await mkdir(path.join(root, '.od', 'runs'), { recursive: true });
  await writeFile(path.join(root, '.od', 'runs', 'state.json'), '{}');
  await mkdir(path.join(root, 'node_modules', 'pkg'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', 'pkg', 'index.js'), '');
  await mkdir(path.join(root, '.live-artifacts', 'artifact-1'), { recursive: true });
  await writeFile(path.join(root, '.live-artifacts', 'artifact-1', 'index.html'), '<!doctype html>');
  await mkdir(path.join(root, '.file-versions'));
  await writeFile(path.join(root, '.file-versions', 'v1.json'), '{}');
}

describe('dot-prefixed user content in managed projects (#6175)', () => {
  let projectsRoot = '';
  const projectId = 'proj1';

  beforeEach(async () => {
    projectsRoot = mkdtempSync(path.join(tmpdir(), 'od-hidden-'));
    await mkdir(path.join(projectsRoot, projectId), { recursive: true });
    await seedProjectTree(path.join(projectsRoot, projectId));
  });

  afterEach(() => {
    if (projectsRoot) rmSync(projectsRoot, { recursive: true, force: true });
  });

  it('lists dot-prefixed files while still skipping the ignore list', async () => {
    const files = await listFiles(projectsRoot, projectId);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('.github/workflows/ci.yml');
    expect(paths).toContain('.storybook/main.ts');
    expect(paths).toContain('.notes.md');
    expect(paths).toContain('index.html');
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.od/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.live-artifacts/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.file-versions/'))).toBe(false);
  });

  it('lists dot-prefixed folders while still skipping the ignore list', async () => {
    const folders = await listProjectFolders(projectsRoot, projectId);
    const names = folders.map((f) => f.path);
    expect(names).toContain('.github');
    expect(names).toContain('.github/workflows');
    expect(names).toContain('.storybook');
    expect(names).toContain('src');
    expect(names).not.toContain('.git');
    expect(names).not.toContain('.od');
    expect(names).not.toContain('node_modules');
    expect(names).not.toContain('.live-artifacts');
    expect(names).not.toContain('.file-versions');
  });

  it('includes visible dot-prefixed user content in full project archives', async () => {
    const { buffer } = await buildProjectArchive(projectsRoot, projectId, '');
    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.keys(zip.files);

    expect(paths).toContain('.github/workflows/ci.yml');
    expect(paths).toContain('.storybook/main.ts');
    expect(paths).toContain('.notes.md');
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.od/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.live-artifacts/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.file-versions/'))).toBe(false);
  });

  it('includes visible dot-prefixed user content in batch archives', async () => {
    await writeFile(path.join(projectsRoot, projectId, 'build'), 'plain user file');
    const { buffer } = await buildBatchArchive(projectsRoot, projectId, [
      '.github/workflows/ci.yml',
      '.notes.md',
      'build',
    ]);
    const zip = await JSZip.loadAsync(buffer);

    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['.github/workflows/ci.yml', '.notes.md', 'build']),
    );
  });

  it('batch archive keeps rejecting reserved daemon state', async () => {
    await expect(
      buildBatchArchive(projectsRoot, projectId, ['.live-artifacts/artifact-1/index.html']),
    ).rejects.toThrow(/ineligible for archive/);
    await expect(
      buildBatchArchive(projectsRoot, projectId, ['.file-versions/v1.json']),
    ).rejects.toThrow(/ineligible for archive/);
  });
});

describe('dot-prefixed entries in imported folders stay hidden (#6175)', () => {
  let baseDir = '';

  beforeEach(async () => {
    baseDir = mkdtempSync(path.join(tmpdir(), 'od-hidden-ext-'));
    await seedProjectTree(baseDir);
  });

  afterEach(() => {
    if (baseDir) rmSync(baseDir, { recursive: true, force: true });
  });

  it('keeps hiding dot-prefixed files for external baseDir projects', async () => {
    const files = await listFiles('/unused/projects', 'unused-id', {
      metadata: { kind: 'prototype', baseDir },
    });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('index.html');
    expect(paths).toContain('src/app.ts');
    expect(paths.some((p) => p.startsWith('.'))).toBe(false);
  });

  it('keeps hiding dot-prefixed folders for external baseDir projects', async () => {
    const folders = await listProjectFolders('/unused/projects', 'unused-id', {
      metadata: { kind: 'prototype', baseDir },
    });
    const names = folders.map((f) => f.path);
    expect(names).toContain('src');
    expect(names.some((p) => p.startsWith('.'))).toBe(false);
  });

  it('keeps rejecting hidden archive roots for external baseDir projects', async () => {
    await expect(
      buildProjectArchive('/unused/projects', 'unused-id', '.github', {
        kind: 'prototype',
        baseDir,
      }),
    ).rejects.toThrow(/hidden path segments/);
  });

  it('keeps rejecting hidden segments in batch archives for external baseDir projects', async () => {
    await expect(
      buildBatchArchive('/unused/projects', 'unused-id', ['.github/workflows/ci.yml'], {
        kind: 'prototype',
        baseDir,
      }),
    ).rejects.toThrow(/ineligible for archive/);
  });
});
