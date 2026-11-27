import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bucketContributionDays,
  contributionsMarkdown,
  dashboardMarkdown,
  renderContributions,
  renderDashboard,
} from '../scripts/profile-analytics-render.mjs';

const section = data => ({ data, observedAt: '2024-02-29T10:40:00.000Z' });

test('monthly and Monday-start weekly buckets keep leap day and week boundaries', () => {
  assert.deepEqual(bucketContributionDays([
    { date: '2024-02-29', count: 4 },
    { date: '2024-02-25', count: 0 },
    { date: '2024-03-01', count: 3 },
    { date: '2024-03-04', count: 2 },
  ]), {
    months: [['2024-02', 4], ['2024-03', 5]],
    weeks: [['2024-02-19', 0], ['2024-02-26', 7], ['2024-03-04', 2]],
  });
  assert.deepEqual(bucketContributionDays([{ date: '2023-01-01', count: 1 }]).weeks, [['2022-12-26', 1]]);
});

test('contribution charts preserve zero days, data gaps, calendar scope and verified totals', () => {
  const activity = section({
    from: '2024-01-01', to: '2024-02-29', totalContributions: 7, activeDays: 2, streak: 1, longestStreak: 2,
    days: [
      { date: '2024-02-26', count: 1 },
      { date: '2024-02-27', count: 0 },
      { date: '2024-02-29', count: 6 },
    ],
    previousYear: { from: '2023-01-01', to: '2023-02-28', totalContributions: 0 },
    previousYearStale: true,
    previousYearObservedAt: '2024-02-29T09:40:00.000Z',
  });
  const svg = renderContributions({ activity });
  assert.match(svg, /<rect class="level-0"[^>]*><title>2024-02-27 UTC · 0<\/title>/);
  assert.match(svg, /<rect class="level-3"[^>]*><title>2024-02-29 UTC · 6<\/title>/);
  assert.doesNotMatch(svg, /2024-02-28 UTC/);
  assert.match(svg, /2024-02 · 7/);
  assert.match(svg, /2024-02-26 · 7/);
  assert.match(svg, /Current streak: 1 day/);
  assert.match(svg, /Comparable year-to-date totals: 2024: 7, 2023: 0/);
  assert.match(svg, /Prior-year data cached 2024-02-29 09:40 UTC/);
  assert.match(contributionsMarkdown(activity), /Same period last year: \*\*0\*\* contributions/);
  assert.match(contributionsMarkdown({ ...activity, stale: true }), /Cached data from 2024-02-29 10:40 UTC/);
});

test('contribution charts distinguish unavailable and complete zero data', () => {
  const missing = renderContributions({ activity: section(null) });
  assert.match(missing, /Verified daily contribution data is unavailable/);
  assert.doesNotMatch(missing, /<rect class="level-0"/);
  assert.match(contributionsMarkdown({ data: null }), /unavailable/);
  const zero = section({
    from: '2024-01-01', to: '2024-01-01', totalContributions: 0, activeDays: 0, streak: 0, longestStreak: 0,
    days: [{ date: '2024-01-01', count: 0 }],
    previousYear: { from: '2023-01-01', to: '2023-01-02', totalContributions: 3 },
  });
  const svg = renderContributions({ activity: zero });
  assert.match(svg, /0 contributions across 0 active days/);
  assert.match(svg, /Comparable prior-year data is unavailable/);
  assert.doesNotMatch(svg, /<rect class="(?:teal|purple)"/);
});

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
