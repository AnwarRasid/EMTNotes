import { readFileSync } from 'node:fs';
const read = (p: string) => readFileSync(p, 'utf8');

test('index.html carries the privacy, language and viewport rules', () => {
  const html = read('index.html');
  expect(html).toMatch(/<html lang="en-SG">/);
  expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(html).toContain('<meta name="color-scheme" content="dark">');
  expect(html).toContain('viewport-fit=cover');
  expect(html).toContain('interactive-widget=resizes-content');
});
test('robots.txt disallows everything', () => {
  expect(read('public/robots.txt')).toBe('User-agent: *\nDisallow: /\n');
});
test.each([
  ['--c-bay', '#121719'], ['--c-text', '#EEF1EC'], ['--c-band-o', '#E2711F'], ['--c-band-y', '#E3BC2B'],
  ['--c-star', '#3381D4'], ['--c-white', '#C8CFCB'], ['--c-missed', '#F26BB0'], ['--c-order', '#B3A1FF'],
  ['--c-done', '#7DD6A9'], ['--t-press', '90ms'], ['--t-reveal', '700ms'], ['--ease-enter', 'cubic-bezier(.22,1,.36,1)'],
])('token %s is %s', (name, value) => {
  expect(read('src/styles/tokens.css')).toContain(`${name}: ${value};`);
});
test('there is no light theme', () => {
  expect(read('src/styles/base.css')).not.toMatch(/prefers-color-scheme:\s*light/);
});
