import { describe, expect, it } from 'vitest';
import { canonicalizeUrl, extractRecipe, parseTimerSeconds } from './extract';

describe('parseTimerSeconds', () => {
  it.each([
    ['Simmer for 10 minutes.', 600],
    ['Simmer 10–15 minutes.', 600], // lower bound of a range
    ['Bake 10-15 mins.', 600],
    ['Rest 1 hour 15 minutes.', 4500], // compound sums
    ['Microwave 90 seconds.', 90],
    ['Bake for 1.5 hours.', 5400],
    ['Cook 5m.', 300],
    ['Season to taste.', null],
    ['Serves 4.', null],
  ])('%s → %s', (text, expected) => {
    expect(parseTimerSeconds(text as string)).toBe(expected);
  });
});

describe('canonicalizeUrl', () => {
  it('prefers <link rel=canonical>', () => {
    const html = '<html><head><link rel="canonical" href="https://chef.example/soup"/></head></html>';
    expect(canonicalizeUrl(html, null, 'https://chef.example/soup?utm=x')).toBe('https://chef.example/soup');
  });

  it('resolves relative canonicals against the final URL', () => {
    const html = '<link rel="canonical" href="/soup"/>';
    expect(canonicalizeUrl(html, null, 'https://chef.example/a/b')).toBe('https://chef.example/soup');
  });

  it('falls back to the JSON-LD url, then the final URL', () => {
    expect(canonicalizeUrl('<html></html>', 'https://chef.example/ld', 'https://chef.example/final')).toBe(
      'https://chef.example/ld',
    );
    expect(canonicalizeUrl('<html></html>', null, 'https://chef.example/final')).toBe('https://chef.example/final');
  });

  it('never returns a vertexaisearch redirect', () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';
    expect(canonicalizeUrl('<html></html>', redirect, 'https://chef.example/final')).toBe('https://chef.example/final');
  });
});

describe('extractRecipe', () => {
  const html = `<!doctype html><html><head>
<link rel="canonical" href="https://chef.example/test-soup"/>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Recipe","name":"Test Soup","description":"A test soup",
"author":{"@type":"Person","name":"Jane"},
"recipeYield":"4 servings","prepTime":"PT10M","totalTime":"PT30M",
"recipeIngredient":["2 cups broth","1 tsp salt"],
"recipeInstructions":[{"@type":"HowToStep","text":"Boil broth for 10 minutes."},{"@type":"HowToStep","text":"Add salt."}],
"nutrition":{"@type":"NutritionInformation","calories":"150 calories"}}
</script></head><body></body></html>`;

  it('extracts a recipe with canonical URL and jsonld method', async () => {
    const r = await extractRecipe(html, 'https://chef.example/test-soup?utm_source=x');
    expect(r).toMatchObject({
      title: 'Test Soup',
      author: 'Jane',
      canonicalUrl: 'https://chef.example/test-soup',
      servings: 4,
      extractionMethod: 'jsonld',
    });
    expect(r?.ingredients).toEqual(['2 cups broth', '1 tsp salt']);
    expect(r?.steps).toHaveLength(2);
    expect(r?.publisherNutrition?.energyKcal).toBe(150);
  });

  it('returns null when the page has no recipe markup', async () => {
    await expect(extractRecipe('<html><body>just a blog post</body></html>', 'https://chef.example/post')).resolves.toBeNull();
  });
});
