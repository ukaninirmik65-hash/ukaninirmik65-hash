import assert from 'node:assert/strict';
import test from 'node:test';
import {
  renderAssets,
  renderReadmeSections,
} from '../scripts/profile-render.mjs';

const section = data => ({ data, observedAt: '2026-11-22T10:32:00.000Z', stale: false });
const counts = { commits: 4, pullRequests: 3, reviews: 2, issues: 1 };

test('language shares define proportional stacked widths with matching language colors', () => {
  const languages = section([
    { name: 'JavaScript', bytes: 300, percentage: 75 },
    { name: 'CSS', bytes: 100, percentage: 25 },
  ]);
  const svg = renderAssets({ languages })['language-distribution.svg'];
  assert.match(svg, /<rect class="lang-0" x="15\.000" y="15" width="252\.000"/);
  assert.match(svg, /<rect class="lang-1" x="267\.000" y="15" width="84\.000"/);
  assert.match(svg, /<circle class="lang-0"[^>]*>[\s\S]*JavaScript[\s\S]*75%/);
  assert.match(svg, /<circle class="lang-1"[^>]*>[\s\S]*CSS[\s\S]*25%/);
  assert.match(svg, /prefers-color-scheme: dark/);
});

test('SVG output identifies the chart, escapes API-provided text, and contains no active elements', () => {
  const languages = section([{ name: '<script>alert("x")</script> J&J \u0003', bytes: 1, percentage: 100 }]);
  for (const svg of Object.values(renderAssets({ languages }))) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg".*role="img" aria-labelledby="title description">/);
    assert.match(svg, /<title id="title">[^<]+<\/title>/);
    assert.match(svg, /<desc id="description">[^<]+<\/desc>/);
    assert.match(svg, /<\/svg>\n$/);
    assert.doesNotMatch(svg, /<script|<foreignObject|<image|onload=|\u0003|&(?!(?:#[0-9]+);)/);
  }
  assert.match(renderAssets({ languages })['language-distribution.svg'], /&#60;script&#62;alert\(&#34;x&#34;\)&#60;\/script&#62; J&#38;J/);
});

test('README escapes markup from API text and omits unverified targets', () => {
  const sections = renderReadmeSections({
    projects: section([
      { name: 'one', title: 'First', description: '<img src=x> & text', url: 'https://github.com/example/one', demoUrl: 'javascript:alert(1)' },
      { name: 'two', title: 'Second', url: 'https://github.com/example/two', demoUrl: 'https://demo.example/?token=abc' },
    ]),
    recent: section([{ kind: 'Commit', title: 'Fix [layout] @example', repo: 'example/one', date: '2026-11-23', url: 'https://github.com/example/one/commit/abcdef' }]),
  });
  assert.match(sections.PROJECTS, /<tr>\s+<td[^>]*>[\s\S]*?<\/td>\s+<td[^>]*>[\s\S]*?<\/td>\s+<\/tr>/);
  assert.match(sections.PROJECTS, /&#60;img src=x&#62; &#38; text/);
  assert.doesNotMatch(sections.PROJECTS, /<img|javascript:|token=/);
  assert.match(sections.RECENT_ACTIVITY, /\[Fix &#91;layout&#93; &#64;example\]\(<https:\/\/github\.com\/example\/one\/commit\/abcdef>\)/);
});

test('README uses an independent timestamp for cached source data and for full success', () => {
  const activity = { ...section({
    from: '2026-01-01',
    to: '2026-11-22',
    counts,
    streak: 1,
    repositories: [{ name: 'example/public-project', url: 'https://github.com/example/public-project' }],
  }), stale: true };
  const sections = renderReadmeSections({
    activity,
    stats: section({ repositories: 7, stars: 0, followers: 3 }),
    lastSuccessfulAt: '2026-11-21T07:15:29.000Z',
  });
  assert.match(sections.STATS, /\| 7 \| 0 \| 3 \|/);
  assert.match(sections.STATS, /\| 4 \| 3 \| 1 day \|/);
  assert.equal(sections.LAST_UPDATED, '**2026-11-21 07:15 UTC** · Last complete data update.');
  assert.equal(renderReadmeSections({ lastSuccessfulAt: '2026-11-21' }).LAST_UPDATED,
    '**2026-11-21 UTC** · Last complete data update.');
});
