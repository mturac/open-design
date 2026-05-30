export function resolveHtmlArtifactFileName(input: {
  baseName: string;
  ext: '.html' | '.jsx' | '.tsx';
  existingFileNames: ReadonlySet<string>;
  savedArtifactName?: string | null;
}): string {
  if (input.ext === '.html' && input.baseName.toLowerCase() === 'index') {
    return 'index.html';
  }

  let fileName = `${input.baseName}${input.ext}`;
  let n = 2;
  while (input.existingFileNames.has(fileName) && input.savedArtifactName !== fileName) {
    fileName = `${input.baseName}-${n}${input.ext}`;
    n += 1;
  }
  return fileName;
}

interface HtmlLinkProjectFile {
  name: string;
  path?: string;
  kind?: string;
  mime?: string;
  mtime: number;
}

export function rewriteHtmlLinksToCurrentProjectFiles(
  html: string,
  projectFiles: readonly HtmlLinkProjectFile[],
): string {
  const latestByTarget = buildLatestHtmlFileIndex(projectFiles);
  if (latestByTarget.size === 0) return html;

  return html.replace(
    /\b(href)\s*=\s*(["'])([^"']+)\2/gi,
    (match, attr: string, quote: string, rawValue: string) => {
      const rewritten = rewriteHtmlLinkTarget(rawValue, latestByTarget);
      return rewritten === rawValue ? match : `${attr}=${quote}${rewritten}${quote}`;
    },
  );
}

function buildLatestHtmlFileIndex(projectFiles: readonly HtmlLinkProjectFile[]): Map<string, string> {
  const latest = new Map<string, HtmlLinkProjectFile>();
  for (const file of projectFiles) {
    if (!isHtmlProjectFile(file)) continue;
    const key = htmlFileFamilyKey(file.name);
    if (!key) continue;
    const current = latest.get(key);
    if (!current || file.mtime > current.mtime) latest.set(key, file);
  }
  return new Map(Array.from(latest, ([key, file]) => [key, file.name]));
}

function isHtmlProjectFile(file: HtmlLinkProjectFile): boolean {
  const name = file.name.toLowerCase();
  return (
    (file.kind === undefined || file.kind === 'html') &&
    (file.mime === undefined || file.mime === 'text/html') &&
    (name.endsWith('.html') || name.endsWith('.htm'))
  );
}

function rewriteHtmlLinkTarget(
  value: string,
  latestByTarget: ReadonlyMap<string, string>,
): string {
  if (!value || value.startsWith('#') || isExternalOrOpaqueUrl(value)) return value;

  const parsed = splitRelativeReference(value);
  if (!isHtmlPath(parsed.pathname)) return value;
  const key = htmlFileFamilyKey(parsed.pathname);
  if (!key) return value;

  const latest = latestByTarget.get(key);
  if (!latest || latest === parsed.pathname) return value;

  const rewrittenPath = preserveRelativePrefix(parsed.pathname, latest);
  return `${rewrittenPath}${parsed.search}${parsed.hash}`;
}

function isExternalOrOpaqueUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//');
}

function splitRelativeReference(value: string): {
  pathname: string;
  search: string;
  hash: string;
} {
  const hashIndex = value.indexOf('#');
  const beforeHash = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
  const hash = hashIndex >= 0 ? value.slice(hashIndex) : '';
  const queryIndex = beforeHash.indexOf('?');
  return {
    pathname: queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash,
    search: queryIndex >= 0 ? beforeHash.slice(queryIndex) : '',
    hash,
  };
}

function isHtmlPath(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

function htmlFileFamilyKey(pathname: string): string | null {
  const slash = pathname.lastIndexOf('/');
  const directory = slash >= 0 ? pathname.slice(0, slash + 1) : '';
  const fileName = slash >= 0 ? pathname.slice(slash + 1) : pathname;
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return null;
  const stem = fileName.slice(0, dot);
  const ext = fileName.slice(dot).toLowerCase();
  if (stem.toLowerCase() === 'index') return null;
  const familyStem = stem.replace(/-\d+$/, '');
  return `${directory}${familyStem}${ext}`.replace(/^\.\//, '');
}

function preserveRelativePrefix(originalPathname: string, latestName: string): string {
  if (originalPathname.startsWith('./') && !latestName.startsWith('./')) {
    return `./${latestName}`;
  }
  return latestName;
}
