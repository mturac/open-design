import { describe, expect, it } from 'vitest';

import type { Brand } from '@open-design/contracts';

import { deriveTokens } from '../src/brands/engine/derive.js';
import { seedFromBrand } from '../src/brands/engine/seed.js';

/**
 * #7409 review blockers (PR #7460):
 *
 * 1. An explicit `0px` radius must survive the whole derivation chain. The
 *    geometry rules floor XS at 1 and SM at 2 and add +2 to LG, so a zero
 *    seed produced rounded variants and the shipped CSS stayed round.
 * 2. Only a *true zero dimension* counts as explicit zero. `0.5rem` has a
 *    zero integer prefix but is a half-rem; `0oops` is malformed. Both must
 *    keep falling back to the default radius, not become square.
 */

const baseBrand: Brand = {
  name: 'Rectilinear Test System',
  tagline: 'Sharp corners, clear intent',
  description: 'A deterministic brand fixture for radius token derivation.',
  sourceUrl: 'https://example.com',
  logo: { primary: null, alternates: [], notes: '' },
  colors: [
    { role: 'accent', hex: '#0055cc', oklch: '', name: 'Blue', usage: 'Primary action' },
    { role: 'background', hex: '#ffffff', oklch: '', name: 'White', usage: 'Canvas' },
    { role: 'foreground', hex: '#161616', oklch: '', name: 'Ink', usage: 'Text' },
  ],
  typography: {
    display: { family: 'system-ui', fallbacks: [], weights: [600] },
    body: { family: 'system-ui', fallbacks: [], weights: [400] },
  },
  voice: {
    adjectives: ['precise'],
    tone: 'direct',
    messagingPillars: ['clarity'],
    vocabulary: { use: ['clear'], avoid: ['vague'] },
  },
  imagery: { style: 'minimal', subjects: [], treatment: 'flat', avoid: [] },
  layout: { radius: '6px', borderWeight: '1px', spacing: 'normal', postureRules: [] },
};

function brandWithRadius(radius: string | undefined): Brand {
  return {
    ...baseBrand,
    layout: { ...baseBrand.layout, ...(radius === undefined ? {} : { radius }) },
  };
}

describe('#7409 derived tokens preserve an explicit zero radius', () => {
  it('deriveTokens keeps every radius variant zero when the seed is zero', () => {
    const seed = seedFromBrand(brandWithRadius('0px'));
    expect(seed.borderRadius).toBe(0);
    const tokens = deriveTokens(seed);
    expect(tokens.borderRadius).toBe(0);
    expect(tokens.borderRadiusXS).toBe(0);
    expect(tokens.borderRadiusSM).toBe(0);
    expect(tokens.borderRadiusLG).toBe(0);
  });

  it('non-zero seeds still get the standard variant ladder', () => {
    const seed = seedFromBrand(brandWithRadius('6px'));
    const tokens = deriveTokens(seed);
    expect(tokens.borderRadius).toBe(6);
    expect(tokens.borderRadiusXS).toBe(2);
    expect(tokens.borderRadiusSM).toBe(4);
    expect(tokens.borderRadiusLG).toBe(8);
  });

  it('positive fractional px values keep the legacy parseInt behavior', () => {
    const seed = seedFromBrand(brandWithRadius('12.5px'));
    const tokens = deriveTokens(seed);
    expect(tokens.borderRadius).toBe(12);
    expect(tokens.borderRadiusXS).toBe(4);
    expect(tokens.borderRadiusSM).toBe(8);
    expect(tokens.borderRadiusLG).toBe(14);
  });
});

describe('#7409 only a true zero dimension counts as explicit zero', () => {
  it('0.5rem is NOT an explicit zero — falls back to the default radius', () => {
    const seed = seedFromBrand(brandWithRadius('0.5rem'));
    expect(seed.borderRadius).toBeGreaterThan(0);
  });

  it('0oops is malformed — falls back to the default radius', () => {
    const seed = seedFromBrand(brandWithRadius('0oops'));
    expect(seed.borderRadius).toBeGreaterThan(0);
  });

  it('0em is an exact zero dimension', () => {
    const seed = seedFromBrand(brandWithRadius('0em'));
    expect(seed.borderRadius).toBe(0);
  });
});
