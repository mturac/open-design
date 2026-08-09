import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildBatchArchive,
  buildProjectArchive,
  listFiles,
  listProjectFolders,
  readProjectFile,
  validateProjectPath,
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
  await writeFile(path.join(root, '.ProjectNotes'), '# mixed-case user file');
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
  await writeFile(path.join(root, '.transcript.jsonl'), '{"role":"user","content":"private"}\n');
  await writeFile(path.join(root, '.transcript.jsonl.tmp.123.abcd'), 'partial transcript');
  await writeFile(path.join(root, '.transcript.lock'), '123');
  await writeFile(path.join(root, '.finalize.lock'), '123');
  await writeFile(path.join(root, '.mcp.json'), '{"mcpServers":{}}');
  await mkdir(path.join(root, '.amr-attachments'));
  await writeFile(path.join(root, '.amr-attachments', 'upload.png'), 'staged image');
  await mkdir(path.join(root, '.od-skills', 'demo'), { recursive: true });
  await writeFile(path.join(root, '.od-skills', 'demo', 'SKILL.md'), '# staged skill');
  await mkdir(path.join(root, '.open-design'));
  await writeFile(path.join(root, '.open-design', 'project.json'), '{}');
  await mkdir(path.join(root, '.pi', 'sessions'), { recursive: true });
  await writeFile(path.join(root, '.pi', 'sessions', 'session.jsonl'), '{}\n');
  await writeFile(path.join(root, '.od-rename-123-456-0-index.html.tmp'), 'temporary rename');
}

const reservedFiles = [
  '.transcript.jsonl',
  '.transcript.jsonl.tmp.123.abcd',
  '.transcript.lock',
  '.finalize.lock',
  '.mcp.json',
  '.amr-attachments/upload.png',
  '.od-skills/demo/SKILL.md',
  '.open-design/project.json',
  '.pi/sessions/session.jsonl',
  '.od-rename-123-456-0-index.html.tmp',
];

const reservedFolders = [
  '.amr-attachments',
  '.od-skills',
  '.open-design',
  '.pi',
];

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
    expect(paths).toContain('.ProjectNotes');
    expect(paths).toContain('index.html');
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.od/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.live-artifacts/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.file-versions/'))).toBe(false);
    for (const reserved of reservedFiles) expect(paths).not.toContain(reserved);
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
    for (const reserved of reservedFolders) expect(names).not.toContain(reserved);
  });

  it('includes visible dot-prefixed user content in full project archives', async () => {
    const { buffer } = await buildProjectArchive(projectsRoot, projectId, '');
    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.keys(zip.files);

    expect(paths).toContain('.github/workflows/ci.yml');
    expect(paths).toContain('.storybook/main.ts');
    expect(paths).toContain('.notes.md');
    expect(paths).toContain('.ProjectNotes');
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.od/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.live-artifacts/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.file-versions/'))).toBe(false);
    for (const reserved of reservedFiles) expect(paths).not.toContain(reserved);
  });

  it('rejects reserved daemon directories as explicit archive roots', async () => {
    const paths = ['.live-artifacts', '.file-versions', ...reservedFolders];
    for (const reserved of paths) {
      await expect(
        buildProjectArchive(projectsRoot, projectId, reserved),
      ).rejects.toThrow(/reserved project path/);
    }
  });

  it('rejects ignored directories as explicit archive roots, including resolved symlink aliases', async () => {
    for (const ignored of ['.git', '.od', 'node_modules']) {
      await expect(
        buildProjectArchive(projectsRoot, projectId, ignored),
      ).rejects.toThrow(/ignored or reserved/);
    }

    await symlink('.git', path.join(projectsRoot, projectId, 'git-alias'), 'dir');
    await expect(
      buildProjectArchive(projectsRoot, projectId, 'git-alias'),
    ).rejects.toThrow(/ignored or reserved/);
  });

  it('includes visible dot-prefixed user content in batch archives', async () => {
    await writeFile(path.join(projectsRoot, projectId, 'build'), 'plain user file');
    const { buffer } = await buildBatchArchive(projectsRoot, projectId, [
      '.github/workflows/ci.yml',
      '.notes.md',
      '.ProjectNotes',
      'build',
    ]);
    const zip = await JSZip.loadAsync(buffer);

    expect(Object.keys(zip.files)).toEqual(
      expect.arrayContaining(['.github/workflows/ci.yml', '.notes.md', '.ProjectNotes', 'build']),
    );
  });

  it('rejects mixed-case aliases to reserved daemon state', async () => {
    const paths = [
      '.MCP.JSON',
      '.TRANSCRIPT.JSONL',
      '.TRANSCRIPT.JSONL.TMP.123.ABCD',
      '.PI/sessions/session.jsonl',
      '.OD-RENAME-123-456-0-index.html.tmp',
    ];

    for (const reserved of paths) {
      expect(() => validateProjectPath(reserved)).toThrow(/reserved project path/);
      await expect(
        buildBatchArchive(projectsRoot, projectId, [reserved]),
      ).rejects.toThrow(/ineligible for archive/);
    }

    await expect(
      readProjectFile(projectsRoot, projectId, '.MCP.JSON'),
    ).rejects.toThrow(/reserved project path/);
    await expect(
      buildProjectArchive(projectsRoot, projectId, '.PI'),
    ).rejects.toThrow(/reserved project path/);
  });

  it('batch archive keeps rejecting reserved daemon state', async () => {
    const paths = [
      '.live-artifacts/artifact-1/index.html',
      '.file-versions/v1.json',
      ...reservedFiles,
    ];
    for (const reserved of paths) {
      await expect(
        buildBatchArchive(projectsRoot, projectId, [reserved]),
      ).rejects.toThrow(/ineligible for archive/);
    }
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

  it('rejects visible archive-root aliases that resolve to hidden imported directories', async () => {
    await mkdir(path.join(baseDir, '.private'));
    await writeFile(path.join(baseDir, '.private', 'secret.txt'), 'private');
    await symlink('.private', path.join(baseDir, 'public-alias'), 'dir');

    await expect(
      buildProjectArchive('/unused/projects', 'unused-id', 'public-alias', {
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
