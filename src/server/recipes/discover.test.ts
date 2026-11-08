import { describe, expect, it } from 'vitest';
import { pantryFixture } from '@/contracts/fixtures';
import {
  buildDiscoveryContext,
  buildDiscoveryPrompt,
  collectDiscoveryUrls,
  isStapleName,
} from './discover';
import { daysToExpiryInTz } from './pantry-view';

// What listPantryForMatching hands discovery: expired rows dropped, soonest expiry first.
const matchingPantry = pantryFixture
  .filter((p) => p.daysToExpiry == null || p.daysToExpiry >= 0)
  .sort((a, b) => (a.daysToExpiry ?? 9999) - (b.daysToExpiry ?? 9999));

describe('isStapleName', () => {
  it.each([['salt', true], ['olive oil', true], ['black pepper', true], ['water', true], ['spinach', false], ['oily fish', false]])(
    '%s → %s',
    (name, expected) => {
      expect(isStapleName(name as string)).toBe(expected);
    },
  );
});

describe('buildDiscoveryContext', () => {
  it('splits expiring (≤3d) from the rest, soonest first', () => {
    const ctx = buildDiscoveryContext(matchingPantry, { diets: [], allergens: [] });
    expect(ctx.expiring.map((p) => p.normalizedName)).toEqual(['chicken thigh', 'spinach', 'milk']);
    expect(ctx.alsoAvailable.length).toBeGreaterThan(0);
    expect(ctx.expiring.every((p) => (p.daysToExpiry ?? 99) <= 3)).toBe(true);
  });
});

describe('buildDiscoveryPrompt', () => {
  it('includes expiring items first, diets, allergens and theme', () => {
    const ctx = buildDiscoveryContext(matchingPantry, { diets: ['gluten_free'], allergens: ['peanut'] }, 'quick dinner');
    const prompt = buildDiscoveryPrompt(ctx);
    expect(prompt).toContain('chicken thigh (1d)');
    expect(prompt).toContain('DIET: gluten_free. EXCLUDE ALLERGENS: peanut.');
    expect(prompt).toContain('THEME: quick dinner');
    expect(prompt).toContain('Do not invent URLs.');
  });

  it('caps free text at 100 chars', () => {
    const ctx = buildDiscoveryContext(matchingPantry, { diets: [], allergens: [] }, 'x'.repeat(200));
    expect(buildDiscoveryPrompt(ctx)).toContain('x'.repeat(100));
    expect(buildDiscoveryPrompt(ctx)).not.toContain('x'.repeat(101));
  });
});

describe('collectDiscoveryUrls', () => {
  it('unions grounding URIs and text URLs, deduped', () => {
    const urls = collectDiscoveryUrls({
      text: 'Soup | https://a.example/soup\nAlso see https://b.example/stew.',
      sources: [
        { uri: 'https://vertexaisearch.cloud.google.com/r/1', title: 'Soup' },
        { uri: 'https://a.example/soup', title: null },
      ],
      webSearchQueries: [],
      searchEntryPointHtml: null,
    });
    expect(urls).toEqual([
      'https://vertexaisearch.cloud.google.com/r/1',
      'https://a.example/soup',
      'https://b.example/stew',
    ]);
  });

  it('drops non-http(s) matches', () => {
    expect(
      collectDiscoveryUrls({ text: 'x', sources: [{ uri: 'ftp://a.example/x', title: null }], webSearchQueries: [], searchEntryPointHtml: null }),
    ).toEqual([]);
  });
});

describe('daysToExpiryInTz', () => {
  it('computes whole-day differences in the given tz', () => {
    // Late evening Nov 7 in Vancouver, already Nov 8 in UTC; the tz must win.
    const now = new Date('2026-11-08T06:30:00Z');
    expect(daysToExpiryInTz('2026-11-07', 'America/Vancouver', now)).toBe(0);
    expect(daysToExpiryInTz('2026-11-08', 'America/Vancouver', now)).toBe(1);
    expect(daysToExpiryInTz('2026-11-06', 'America/Vancouver', now)).toBe(-1);
  });
});
