type ArtifactRenderTarget = {
  executeJavaScriptInIsolatedWorld: (
    worldId: number,
    scripts: Array<{ code: string }>,
    userGesture?: boolean,
  ) => Promise<unknown>;
};

const DEFAULT_IMAGE_RENDER_TIMEOUT_MS = 30_000;
const ARTIFACT_RENDER_WORLD_ID = 1001;

function validatedTimeout(timeoutMs: number): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("Image render timeout must be a positive finite number");
  }
  return Math.ceil(timeoutMs);
}

export function artifactRenderReadinessScript(timeoutMs: number): string {
  const timeout = validatedTimeout(timeoutMs);
  return `(function() {
    var runtimeJsx = document.querySelector('script[type="text/babel"], script[type="text/jsx"]');
    if (!runtimeJsx) return Promise.resolve(true);

    var ignoredTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE']);

    function hasMountedChild(root) {
      if (!root) return false;
      return Array.from(root.childNodes).some(function(node) {
        if (node.nodeType === 3) return Boolean(node.nodeValue && node.nodeValue.trim());
        return node.nodeType === 1 && !ignoredTags.has(node.tagName);
      });
    }

    function hasMountedContent() {
      if (!document.body) return false;
      var roots = Array.from(document.body.querySelectorAll(
        '#root, #app, [data-reactroot], [data-v-app]'
      ));
      if (roots.length > 0) return roots.some(hasMountedChild);
      return hasMountedChild(document.body);
    }

    return new Promise(function(resolve) {
      var settled = false;
      var settling = false;
      var timer;
      var observer = new MutationObserver(check);

      function finish(ready) {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timer);
        resolve(ready);
      }

      function check() {
        if (settled || settling || !hasMountedContent()) return;
        settling = true;
        requestAnimationFrame(function() {
          requestAnimationFrame(function() {
            settling = false;
            if (hasMountedContent()) finish(true);
          });
        });
      }

      observer.observe(document.documentElement, {
        characterData: true,
        childList: true,
        subtree: true
      });
      timer = setTimeout(function() { finish(false); }, ${timeout});
      check();
    });
  })()`;
}

export async function waitForRenderedArtifactContent(
  target: ArtifactRenderTarget,
  timeoutMs = DEFAULT_IMAGE_RENDER_TIMEOUT_MS,
): Promise<void> {
  const timeout = validatedTimeout(timeoutMs);
  const ready = await target.executeJavaScriptInIsolatedWorld(
    ARTIFACT_RENDER_WORLD_ID,
    [{ code: artifactRenderReadinessScript(timeout) }],
    false,
  );
  if (ready !== true) {
    throw new Error(`Image export timed out waiting for runtime-rendered content (${timeout}ms)`);
  }
}

export async function waitForArtifactResources(
  operation: Promise<void>,
  timeoutMs = DEFAULT_IMAGE_RENDER_TIMEOUT_MS,
): Promise<void> {
  const timeout = validatedTimeout(timeoutMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Image export timed out waiting for late resources (${timeout}ms)`)),
      timeout,
    );
  });
  try {
    await Promise.race([operation, timedOut]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function waitForArtifactContent(
  format: "image" | "pdf",
  target: ArtifactRenderTarget,
  settleResources: () => Promise<void>,
): Promise<void> {
  if (format === "pdf") {
    await settleResources();
    return;
  }
  await waitForRenderedArtifactContent(target);
  await waitForArtifactResources(settleResources());
}
