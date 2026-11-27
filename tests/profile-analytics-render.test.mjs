import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dashboardMarkdown,
  renderDashboard,
} from '../scripts/profile-analytics-render.mjs';

const section = data => ({ data, observedAt: '2024-02-29T10:40:00.000Z' });

test('dashboard escapes repository metadata and distinguishes zero from unavailable', () => {
  const stats = section({
    repositories: 4, originals: 3, stars: 0, followers: 1,
    latestRepository: { name: 'test<repo>', url: 'javascript:bad()', date: '2024-02-29' },
  });
  const activity = section({ counts: { commits: 2, pullRequests: 0, issues: 0 }, streak: 0 });
  const languages = section([{ name: 'C&<script>' }]);
  const svg = renderDashboard({ stats, activity, languages, lastSuccessfulAt: '2024-03-01T00:11:00.000Z' });
  assert.match(svg, /Stars received: 0/);
  assert.match(svg, /Forks received: Unavailable/);
  assert.match(svg, /test&#60;repo&#62;/);
  assert.match(svg, /C&#38;&#60;script&#62;/);
  assert.match(svg, /Last complete refresh · 2024-03-01 00:11 UTC/);
  assert.match(svg, /<svg[^>]+role="img"[^>]+>/);
  assert.match(svg, /prefers-color-scheme: dark/);
  assert.doesNotMatch(svg, /<script>|javascript:|<foreignObject/);
  const text = dashboardMarkdown(stats, activity, languages);
  assert.match(text, /\| 4 \| 0 \| 1 \|/);
  assert.match(text, /\| 2 \| 0 \| 0 days \|/);
  assert.doesNotMatch(text, /javascript:/);
});
