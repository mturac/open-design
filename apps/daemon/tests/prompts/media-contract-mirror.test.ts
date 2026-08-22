import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// `MEDIA_USER_REPLY_CONTRACT` exists twice: the daemon owns the copy that
// composeSystemPrompt actually renders, and packages/contracts carries an
// identical one. Nothing imports the contracts copy today, which is precisely
// what makes the duplication dangerous — editing it looks like changing
// behaviour and changes nothing.
//
// That already happened: the three-outcome refusal wording was added to the
// contracts copy alone, so the primary agent flow kept describing a
// content-safety refusal as a temporary outage. This test is the cheap guard
// against a repeat. Delete it only by deleting one of the two copies.

function templateBody(path: string): string {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const marker = 'export const MEDIA_USER_REPLY_CONTRACT = `';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`MEDIA_USER_REPLY_CONTRACT not found in ${path}`);
  let index = start + marker.length;
  // Scan for the terminating backtick, skipping escaped ones -- the body
  // itself contains \` around inline code, so a naive search truncates it.
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === '`') return source.slice(start + marker.length, index);
    index += 1;
  }
  throw new Error(`unterminated template literal in ${path}`);
}

function generationContractBody(path: string): string {
  const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
  const marker = 'export const MEDIA_GENERATION_CONTRACT = `';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`MEDIA_GENERATION_CONTRACT not found in ${path}`);
  let index = start + marker.length;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === '`') return source.slice(start + marker.length, index);
    index += 1;
  }
  throw new Error(`unterminated template literal in ${path}`);
}

describe('MEDIA_USER_REPLY_CONTRACT mirrors', () => {
  const daemonBody = templateBody('../../src/prompts/media-contract.ts');
  const contractsBody = templateBody(
    '../../../../packages/contracts/src/prompts/media-contract.ts',
  );

  it('keeps the daemon copy and the contracts copy identical', () => {
    expect(daemonBody).toBe(contractsBody);
  });

  it('carries safe English and Simplified Chinese failure categories', () => {
    const normalized = daemonBody.replace(/\s+/g, ' ');
    expect(daemonBody).toContain('图片已生成');
    expect(daemonBody).toContain('图片未生成：内容安全策略拒绝了该请求');
    expect(daemonBody).toContain('MEDIA_EXECUTION_DISABLED');
    expect(daemonBody).toContain('本次任务未启用图片生成');
    expect(daemonBody).toContain('STUB_PROVIDER_DISABLED');
    expect(daemonBody).toContain('所选图片模型未配置可用的生成器');
    expect(daemonBody).toContain('MEDIA_DISPATCHER_UNREACHABLE');
    expect(daemonBody).toContain('无法连接本地媒体生成调度器');
    expect(daemonBody).toContain('MEDIA_DISPATCH_NOT_INVOKED');
    expect(daemonBody).toContain('未调用媒体生成调度器');
    expect(daemonBody).toContain('MEDIA_DISPATCH_FAILED');
    expect(daemonBody).toContain('媒体生成调度失败，原因未分类');
    expect(normalized).toContain('Media generation was disabled for this run');
    expect(normalized).toContain('The selected image model has no configured renderer');
    expect(normalized).toContain('The local media dispatcher could not be reached');
    expect(normalized).toContain('The media dispatcher was not invoked');
    expect(normalized).toContain('The media dispatcher failed for an unclassified reason');
    expect(daemonBody).toContain('safety_rejection');
    expect(daemonBody).toContain('错误代码：\\`MEDIA_EXECUTION_DISABLED\\`');
    expect(daemonBody).toContain('错误代码：\\`{code}\\`');
    expect(normalized).toContain('structured dispatcher or provider error');
    expect(daemonBody).not.toContain('图片生成服务暂时不可用');
  });

  it('carries the Windows PowerShell Start-Process invocation for media generate and media wait', () => {
    expect(contractsBody).not.toContain('& $env:OD_NODE_BIN $env:OD_BIN media generate');
  });
});

/**
 * Extract raw content of every ```powershell … ``` fence from a contract body.
 *
 * In the raw template-literal body returned by generationContractBody() the
 * backtick character is escaped as \`, so code fences appear as \`\`\`powershell
 * rather than the three plain backticks you see in the rendered text.
 */
function extractPowershellBlocks(contractBody: string): string[] {
  const re = /\\\`\\\`\\\`powershell\n([\s\S]*?)\\\`\\\`\\\`/g;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(contractBody)) !== null) blocks.push(m[1]);
  return blocks;
}

describe('MEDIA_GENERATION_CONTRACT Windows PowerShell guidance', () => {
  const contractsGen = generationContractBody(
    '../../../../packages/contracts/src/prompts/media-contract.ts',
  );
  const daemonGen = generationContractBody('../../src/prompts/media-contract.ts');

  it('warns against the & call operator on Windows PowerShell', () => {
    expect(contractsGen).toContain('Windows PowerShell');
    expect(contractsGen).toContain('Start-Process');
    expect(contractsGen).toContain('-RedirectStandardOutput');
    expect(contractsGen).toContain('-RedirectStandardError');
  });

  it('contracts: exposes two powershell blocks — one for generate, one for wait', () => {
    const blocks = extractPowershellBlocks(contractsGen);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]).toContain('media generate');
    expect(blocks[1]).toContain('media wait');
  });

  it('contracts: each powershell block contains a structurally complete Start-Process call', () => {
    const required = [
      'Start-Process',
      '-FilePath $env:OD_NODE_BIN',
      '-ArgumentList',
      '-NoNewWindow',
      '-Wait',
      '-PassThru',
      '-RedirectStandardOutput',
      '-RedirectStandardError',
      'Get-Content',
    ] as const;
    for (const block of extractPowershellBlocks(contractsGen)) {
      for (const flag of required) {
        expect(block, `flag "${flag}" missing from block`).toContain(flag);
      }
    }
  });

  it('contracts: redirect-output files differ between generate and wait blocks (no shared-file race)', () => {
    const blocks = extractPowershellBlocks(contractsGen);
    const outGen = blocks[0].match(/\$out\s*=\s*"([^"]+)"/)?.[1];
    const outWait = blocks[1].match(/\$out\s*=\s*"([^"]+)"/)?.[1];
    expect(outGen, 'generate block must declare $out').toBeTruthy();
    expect(outWait, 'wait block must declare $out').toBeTruthy();
    expect(outGen).not.toBe(outWait);
  });

  it('daemon: generate+wait loop covers both commands and handles immediate completion', () => {
    const blocks = extractPowershellBlocks(daemonGen);
    const loopBlock = blocks.find(
      (b) => b.includes('media wait') && b.includes('media generate'),
    );
    expect(loopBlock, 'daemon must have a block covering both generate and wait').toBeTruthy();
    expect(loopBlock).toContain('ExitCode');
    expect(loopBlock).toContain('taskId');
    expect(loopBlock).toContain('nextSince');
    expect(loopBlock).toMatch(/if\s*\(\$\w+\.nextSince\)/);
  });

  it('daemon: Invoke-OdMedia redirect files do not collide with standalone generate block', () => {
    const blocks = extractPowershellBlocks(daemonGen);
    const simpleOut = blocks[0].match(/\$out\s*=\s*"([^"]+)"/)?.[1];
    const functionOut = blocks[1].match(/\$out\s*=\s*"([^"]+)"/)?.[1];
    expect(simpleOut, 'standalone generate block must declare $out').toBeTruthy();
    expect(functionOut, 'Invoke-OdMedia block must declare $out').toBeTruthy();
    expect(simpleOut).not.toBe(functionOut);
  });
});
