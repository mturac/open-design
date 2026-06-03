import postcss, { type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';
import { readExpandedIndexCss } from '../helpers/read-expanded-css';

const css = readExpandedIndexCss();
const root = postcss.parse(css, { from: 'src/index.css' });

function declarationsFor(selector: string): Declaration[] {
  const declarations: Declaration[] = [];
  root.walkRules((rule: Rule) => {
    const selectors = rule.selectors.map((item) => item.trim());
    if (!selectors.includes(selector)) return;
    rule.walkDecls((decl) => {
      declarations.push(decl);
    });
  });
  if (declarations.length === 0) throw new Error(`Missing CSS block for ${selector}`);
  return declarations;
}

function ruleValue(selector: string, property: string): string {
  const declarations = declarationsFor(selector).filter((decl) => decl.prop === property);
  const declaration = declarations.at(-1);
  if (!declaration) throw new Error(`Missing CSS property ${property} for ${selector}`);
  return declaration.value;
}

describe('Settings agent card styles', () => {
  it('lets selected execution cards wrap text instead of clipping it', () => {
    expect(ruleValue('.agent-card-name', 'white-space')).toBe('nowrap');
    expect(ruleValue('.agent-card-name', 'overflow')).toBe('hidden');

    expect(ruleValue('.agent-card-installed.active .agent-card-select', 'align-items')).toBe(
      'flex-start',
    );
    expect(ruleValue('.agent-card-installed.active .agent-card-name', 'white-space')).toBe(
      'normal',
    );
    expect(ruleValue('.agent-card-installed.active .agent-card-name', 'overflow')).toBe(
      'visible',
    );
    expect(ruleValue('.agent-card-installed.active .agent-card-name', 'flex-wrap')).toBe(
      'wrap',
    );
    expect(ruleValue('.agent-card-installed.active .agent-card-tagline', 'flex-basis')).toBe(
      '100%',
    );
    expect(ruleValue('.agent-card-installed.active .agent-card-tagline', 'white-space')).toBe(
      'normal',
    );
    expect(ruleValue('.agent-card-installed.active .agent-card-tagline', 'overflow')).toBe(
      'visible',
    );
    expect(ruleValue('.agent-card-installed.active .agent-card-meta', 'white-space')).toBe(
      'normal',
    );
    expect(ruleValue('.agent-card-installed.active .agent-card-meta', 'overflow')).toBe(
      'visible',
    );
  });
});
