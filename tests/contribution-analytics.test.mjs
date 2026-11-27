import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dateKey, fetchActivity, parsePublicCalendar, previousYearPeriod, summarizeCalendar,
} from '../scripts/profile-data.mjs';

const DAY = 86_400_000;
const username = 'example';

function calendar({ from, to }, counts = {}) {
  const days = [];
  for (let day = Date.parse(from); day <= Date.parse(to); day += DAY) {
    const date = dateKey(day);
    days.push({ date, count: counts[date] ?? 0 });
  }
  return days;
}

function calendarHtml(days) {
  return days.map(({ date, count }) =>
    `<td id="day-${date}" data-date="${date}"></td><tool-tip for="day-${date}">${count} contributions on ${date}</tool-tip>`).join('');
}

function graphResponse(days) {
  return Response.json({ data: { user: { login: username, contributionsCollection: {
    restrictedContributionsCount: 0,
    contributionCalendar: { weeks: [{ contributionDays: days.map(({ date, count }) => ({ date, contributionCount: count })) }] },
    totalCommitContributions: 0,
    totalPullRequestContributions: 0,
    totalPullRequestReviewContributions: 0,
    totalIssueContributions: 0,
    commitContributionsByRepository: [],
    pullRequestContributionsByRepository: [],
    pullRequestReviewContributionsByRepository: [],
    issueContributionsByRepository: [],
  } } } });
}

async function runActivity(period, counts, history, onWarning) {
  const days = calendar(period, counts);
  const request = async (url, options) => {
    const parsed = new URL(url);
    if (parsed.hostname === 'api.github.com') {
      assert.equal(options.token, 'test-only');
      assert.equal(JSON.parse(options.body).variables.from, `${period.from}T00:00:00Z`);
      return graphResponse(days);
    }
    assert.equal(options, undefined);
    if (parsed.searchParams.get('from') === period.from) return new Response(calendarHtml(days));
    if (!history) throw new Error('Historical calendar unavailable');
    assert.equal(parsed.searchParams.get('to'), history.at(-1).date);
    return new Response(calendarHtml(history));
  };
  return fetchActivity({ username, period, now: `${period.to}T12:00:00Z`, tokens: ['test-only'], request, onWarning });
}

test('date series uses consecutive UTC dates through leap day and rejects gaps', () => {
  const period = { from: '2024-02-28', to: '2024-03-02' };
  const days = calendar(period, { '2024-02-29': 3, '2024-03-01': 2 });
  assert.deepEqual(parsePublicCalendar(calendarHtml([...days].reverse()), period), days);
  assert.throws(() => parsePublicCalendar(calendarHtml(days.filter(day => day.date !== '2024-02-29')), period), /incomplete/);
  assert.deepEqual(summarizeCalendar(days), { totalContributions: 5, activeDays: 2, longestStreak: 2 });
});

test('calendar-date comparison clamps Feb 29 and retains dates after the leap day', () => {
  assert.deepEqual(previousYearPeriod({ to: '2024-02-29' }), { from: '2023-01-01', to: '2023-02-28' });
  assert.deepEqual(previousYearPeriod({ to: '2024-03-01' }), { from: '2023-01-01', to: '2023-03-01' });
});

test('current streak joins consecutive public days across the year boundary', async () => {
  const history = calendar({ from: '2024-01-01', to: '2024-12-31' },
    { '2024-01-01': 5, '2024-12-30': 2, '2024-12-31': 1 });
  const activity = await runActivity({ from: '2025-01-01', to: '2025-01-03' },
    { '2025-01-01': 1, '2025-01-02': 2 }, history);
  assert.equal(activity.streak, 4);
  assert.equal(activity.longestStreak, 2);
  assert.equal(activity.activeDays, 2);
  assert.equal(activity.totalContributions, 3);
  assert.deepEqual(activity.previousYear,
    { from: '2024-01-01', to: '2024-01-03', totalContributions: 5, activeDays: 1, longestStreak: 1 });
  assert.deepEqual(activity.days.map(day => day.count), [1, 2, 0]);
});

test('on an inactive Jan 1 the current streak can continue through yesterday', async () => {
  const history = calendar({ from: '2024-01-01', to: '2024-12-31' },
    { '2024-12-30': 2, '2024-12-31': 1 });
  const activity = await runActivity({ from: '2025-01-01', to: '2025-01-01' }, {}, history);
  assert.equal(activity.streak, 2);
  assert.equal(activity.longestStreak, 0);
  assert.equal(activity.previousYear.totalContributions, 0);
});

test('a missing previous calendar retains current analytics and leaves a boundary streak unknown', async () => {
  const warnings = [];
  const activity = await runActivity({ from: '2025-01-01', to: '2025-01-02' },
    { '2025-01-01': 3 }, null, message => warnings.push(message));
  assert.equal(activity.streak, null);
  assert.equal(activity.previousYear, null);
  assert.equal(activity.totalContributions, 3);
  assert.equal(activity.longestStreak, 1);
  assert.match(warnings[0], /previous-year public contribution calendar could not refresh/);
});
