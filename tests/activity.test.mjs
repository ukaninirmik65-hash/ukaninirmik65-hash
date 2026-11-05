import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  fetchAllPages,
  requestGitHub,
  parseContributionHTML,
  normalizeGraphQL,
  summarizeRepositories,
  calculateStreaks,
  buildModel,
  renderAssets,
  renderLatestRepositoryLinks,
  updateProfile,
} from '../scripts/update-profile.mjs';

const json = (value, options = {}) => new Response(JSON.stringify(value), {
  status: 200,
  headers: { 'content-type': 'application/json', ...options.headers },
  ...options,
});

const calendarHTML = `
  <td data-date="2026-01-01" id="day-a" data-level="1"></td>
  <td data-date="2026-01-02" id="day-b" data-level="4"></td>
  <td data-date="2026-01-03" id="day-c" data-level="0"></td>
  <tool-tip for="day-b">1,234 contributions on January 2nd.</tool-tip>
  <tool-tip for="day-c">No contributions on January 3rd.</tool-tip>
  <tool-tip for="day-a">1 contribution on January 1st.</tool-tip>`;

test('repository pagination follows the Link header even after a short page', async () => {
  const visited = [];
  const request = async (url) => {
    visited.push(String(url));
    return visited.length === 1
      ? json([{ id: 1 }], { headers: { link: '<https://api.github.com/users/example/repos?page=2>; rel="next"' } })
      : json([{ id: 2 }]);
  };
  const result = await fetchAllPages('https://api.github.com/users/example/repos?per_page=100', { request });
  assert.deepEqual(result.map((repo) => repo.id), [1, 2]);
  assert.equal(visited.length, 2);
  assert.match(visited[1], /page=2/);
});

test('repository totals count real stars and forks across original and forked public repos', () => {
  const result = summarizeRepositories([
    { id: 1, name: 'one', stargazers_count: 5, forks_count: 2, fork: false, archived: false },
    { id: 2, name: 'two', stargazers_count: 3, forks_count: 4, fork: true, archived: false },
    { id: 3, name: 'three', stargazers_count: 0, forks_count: 1, fork: false, archived: true },
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.stars, 8);
  assert.equal(result.forks, 7);
  assert.equal(result.originals, 2);
});

test('public calendar joins exact tooltip counts to dates instead of estimating from color', () => {
  const result = parseContributionHTML(calendarHTML, { from: '2026-01-01', to: '2026-01-03' });
  assert.deepEqual(result.days.map(({ date, count }) => ({ date, count })), [
    { date: '2026-01-01', count: 1 },
    { date: '2026-01-02', count: 1234 },
    { date: '2026-01-03', count: 0 },
  ]);
  assert.equal(result.total, 1235);
});

test('calendar parser refuses a missing exact count rather than turning it into zero', () => {
  const missing = calendarHTML.replace('<tool-tip for="day-b">1,234 contributions on January 2nd.</tool-tip>', '');
  assert.throws(() => parseContributionHTML(missing, { from: '2026-01-01', to: '2026-01-03' }));
});

test('calendar parser refuses a gap in the requested date range', () => {
  const gap = calendarHTML.replace('<td data-date="2026-01-02" id="day-b" data-level="4"></td>', '');
  assert.throws(() => parseContributionHTML(gap, { from: '2026-01-01', to: '2026-01-03' }));
});

test('streak includes yesterday when today has no contribution', () => {
  const result = calculateStreaks([
    { date: '2026-01-01', count: 1 },
    { date: '2026-01-02', count: 1 },
    { date: '2026-01-03', count: 0 },
  ], '2026-01-03');
  assert.equal(result.current, 2);
  assert.equal(result.longest, 2);
});

test('a completed empty day breaks the current streak without changing the longest streak', () => {
  const result = calculateStreaks([
    { date: '2026-01-01', count: 1 },
    { date: '2026-01-02', count: 1 },
    { date: '2026-01-03', count: 0 },
    { date: '2026-01-04', count: 0 },
  ], '2026-01-04');
  assert.equal(result.current, 0);
  assert.equal(result.longest, 2);
});

test('request retries temporary upstream failures and succeeds without a real delay', async () => {
  let attempts = 0;
  const sleeps = [];
  const response = await requestGitHub('https://api.github.com/users/example', {
    fetchImpl: async () => (++attempts < 3 ? new Response('temporary', { status: 503 }) : json({ login: 'example' })),
    sleep: async (ms) => { sleeps.push(ms); },
    maxAttempts: 3,
  });
  assert.equal(response.status, 200);
  assert.equal(attempts, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps.every((ms) => ms >= 0 && ms <= 10000));
});

test('authentication failures are not retried and do not reveal a token or response body', async () => {
  let attempts = 0;
  const token = 'ghp_TEST_TOKEN_MUST_NEVER_APPEAR_IN_AN_ERROR';
  await assert.rejects(
    requestGitHub('https://api.github.com/users/example', {
      token,
      fetchImpl: async () => { attempts++; return new Response(token, { status: 401 }); },
      sleep: async () => assert.fail('401 must not sleep or retry'),
      maxAttempts: 3,
    }),
    (error) => !String(error).includes(token),
  );
  assert.equal(attempts, 1);
});

test('public HTML requests never receive the GitHub API authorization header', async () => {
  let headers;
  await requestGitHub('https://github.com/users/example/contributions', {
    token: 'ghp_TEST_TOKEN',
    fetchImpl: async (_url, options) => { headers = new Headers(options.headers); return new Response('calendar'); },
  });
  assert.equal(headers.has('authorization'), false);
});

test('required API failure leaves previously generated assets untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-required-failure-'));
  const sentinel = join(root, 'unchanged.txt');
  await writeFile(sentinel, 'last successful output');
  await assert.rejects(updateProfile({
    username: 'example',
    root,
    today: '2026-01-03',
    request: async () => { throw new Error('GitHub temporarily unavailable'); },
  }));
  assert.equal(await readFile(sentinel, 'utf8'), 'last successful output');
  assert.deepEqual(await readdir(root), ['unchanged.txt']);
});

const repository = {
  id: 1,
  name: 'interface',
  private: false,
  stargazers_count: 2,
  forks_count: 1,
  fork: false,
  archived: false,
  pushed_at: '2026-01-02T12:00:00Z',
  language: 'JavaScript',
};

const calendar = () => parseContributionHTML(calendarHTML, { from: '2026-01-01', to: '2026-01-03' });
const sampleModel = (overrides = {}) => buildModel({
  user: { login: 'example', followers: 4 },
  repositories: [repository],
  languages: { bytes: { JavaScript: 750, CSS: 250 }, observedAt: '2026-01-03' },
  contributions: calendar(),
  today: '2026-01-03',
  ...overrides,
});

test('model strips unrequested account and repository fields from the public snapshot', () => {
  const model = sampleModel({
    user: { login: 'example', followers: 4, token: 'SECRET_USER_FIELD' },
    repositories: [{ ...repository, token: 'SECRET_REPO_FIELD' }, { ...repository, id: 2, name: 'private-project', private: true }],
  });
  const serialized = JSON.stringify(model);
  assert.equal(model.totals.total, 1);
  assert.doesNotMatch(serialized, /SECRET_|private-project/);
});

test('unchanged API data retains its observation date and produces byte-identical SVGs', () => {
  const first = sampleModel();
  const second = sampleModel({ previous: first, today: '2026-01-04' });
  assert.equal(second.observedAt, first.observedAt);
  assert.deepEqual(renderAssets(second), renderAssets(first));
});

test('SVGs escape API strings and provide accessible titles without active content', () => {
  const model = sampleModel({ repositories: [{ ...repository, name: 'ui<&"' }] });
  const outputs = renderAssets(model);
  assert.equal(Object.keys(outputs).length, 8);
  assert.match(outputs['latest-repositories.svg'], /ui&lt;&amp;&quot;/);
  for (const content of Object.values(outputs)) {
    assert.match(content, /<title[^>]*>[^<]+<\/title>/);
    assert.match(content, /role="img"/);
    assert.doesNotMatch(content, /<script|<foreignObject|onload\s*=/i);
    assert.doesNotMatch(content, /NaN|Infinity|undefined/);
  }
});

test('latest repository output prioritizes original project repositories and provides direct GitHub links', () => {
  const model = sampleModel({ repositories: [
    { ...repository, name: 'profile-owner', pushed_at: '2026-01-03T00:00:00Z' },
    { ...repository, id: 2, name: 'project-one', description: 'A recent frontend project', pushed_at: '2026-01-02T00:00:00Z' },
    { ...repository, id: 3, name: 'forked-project', fork: true, pushed_at: '2026-01-04T00:00:00Z' },
  ], user: { login: 'profile-owner', followers: 4 } });
  const links = renderLatestRepositoryLinks(model);
  assert.match(links, /\[\*\*project-one\*\*\]\(https:\/\/github\.com\/profile-owner\/project-one\)/);
  assert.doesNotMatch(links, /profile-owner\*\*\]|forked-project/);
  assert.match(renderAssets(model)['latest-repositories.svg'], /A recent frontend project/);
});

test('pagination rejects an off-site next link before making a second request', async () => {
  let calls = 0;
  await assert.rejects(fetchAllPages('https://api.github.com/users/example/repos', {
    request: async () => {
      calls++;
      return json([{ id: 1 }], { headers: { link: '<https://untrusted.example/steal>; rel="next"' } });
    },
  }), /Unsafe/);
  assert.equal(calls, 1);
});

test('pagination rejects a duplicate repository rather than inflating the totals', async () => {
  await assert.rejects(fetchAllPages('https://api.github.com/users/example/repos', {
    request: async () => json([{ id: 1 }, { id: 1 }]),
  }), /pagination changed/);
});

test('a long Retry-After fails promptly for a later run instead of blocking', async () => {
  let calls = 0;
  await assert.rejects(requestGitHub('https://api.github.com/users/example', {
    fetchImpl: async () => {
      calls++;
      return new Response('rate limited', { status: 429, headers: { 'retry-after': '3600' } });
    },
    sleep: async () => assert.fail('long rate limits must not sleep'),
  }), /HTTP 429/);
  assert.equal(calls, 1);
});

const graphPayload = () => ({
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: { weeks: [{ contributionDays: calendar().days.map(({ date, count }) => ({ date, contributionCount: count })) }] },
        totalRepositoriesWithContributedCommits: 2,
        commitContributionsByRepository: [
          { repository: { isPrivate: false }, contributions: { totalCount: 7 } },
          { repository: { isPrivate: true }, contributions: { totalCount: 11 } },
        ],
        pullRequestContributions: {
          pageInfo: { hasNextPage: false },
          nodes: [
            { isRestricted: false, pullRequest: { repository: { isPrivate: false } } },
            { isRestricted: false, pullRequest: { repository: { isPrivate: true } } },
            { isRestricted: true, pullRequest: null },
          ],
        },
        issueContributions: { pageInfo: { hasNextPage: true }, nodes: [] },
        pullRequestReviewContributions: {
          pageInfo: { hasNextPage: false },
          nodes: [{ isRestricted: false, pullRequestReview: { pullRequest: { repository: { isPrivate: false } } } }],
        },
      },
    },
  },
});

test('GraphQL breakdown excludes private contributions and omits truncated metrics', () => {
  const payload = graphPayload();
  const result = normalizeGraphQL(payload, { from: '2026-01-01', to: '2026-01-03' });
  assert.deepEqual(result.metrics, { commits: 7, pullRequests: 1, reviews: 1 });
  payload.data.user.contributionsCollection.totalRepositoriesWithContributedCommits = 101;
  const truncated = normalizeGraphQL(payload, { from: '2026-01-01', to: '2026-01-03' });
  assert.equal('commits' in truncated.metrics, false);
});

function publicRequest({ optionalFailure = false, authenticatedCountsDiffer = false } = {}) {
  return async (url) => {
    const target = String(url);
    if (target.endsWith('/users/example')) return json({ login: 'example', followers: 4, public_repos: 1 });
    if (target.includes('/users/example/repos?')) return json([repository]);
    if (target.endsWith('/languages')) {
      if (optionalFailure) throw new Error('temporary language failure');
      return json({ JavaScript: 750, CSS: 250 });
    }
    if (target.includes('github.com/users/example/contributions')) {
      if (optionalFailure) throw new Error('temporary calendar failure');
      return new Response(calendarHTML);
    }
    if (target.endsWith('/graphql')) {
      const payload = graphPayload();
      if (authenticatedCountsDiffer) payload.data.user.contributionsCollection.contributionCalendar.weeks[0].contributionDays[0].contributionCount += 999;
      return json(payload);
    }
    throw new Error(`Unexpected fixture request: ${target}`);
  };
}

test('repeating a successful refresh makes no new file changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-determinism-'));
  await writeFile(join(root, 'README.md'), '## Latest Repository Updates\n\n<!-- LATEST_REPOSITORIES:START -->\n<!-- LATEST_REPOSITORIES:END -->\n');
  const options = { username: 'example', root, today: '2026-01-03', request: publicRequest() };
  const first = await updateProfile(options);
  assert.equal(first.changed, 10);
  assert.match(await readFile(join(root, 'README.md'), 'utf8'), /\[\*\*interface\*\*\]\(https:\/\/github\.com\/example\/interface\)/);
  const second = await updateProfile(options);
  assert.equal(second.changed, 0);
  assert.deepEqual(second.model, first.model);
});

test('optional failures retain successful calendar and languages with their original dates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-optional-failure-'));
  const first = await updateProfile({ username: 'example', root, today: '2026-01-03', request: publicRequest() });
  const retained = await updateProfile({ username: 'example', root, today: '2026-01-04', request: publicRequest({ optionalFailure: true }) });
  assert.deepEqual(retained.model.languages, first.model.languages);
  assert.deepEqual(retained.model.contributions, first.model.contributions);
  assert.equal(retained.model.contributions.to, '2026-01-03');
  assert.equal(retained.model.languages.observedAt, '2026-01-03');
});

test('a broader authenticated calendar never replaces publicly visible calendar counts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'profile-public-scope-'));
  const result = await updateProfile({
    username: 'example',
    root,
    today: '2026-01-03',
    token: 'ghp_TEST_TOKEN',
    request: publicRequest({ authenticatedCountsDiffer: true }),
  });
  assert.equal(result.model.contributions.total, 1235);
  assert.equal(result.model.contributions.metrics, undefined);
  const serialized = await readFile(join(root, 'assets', 'profile-data.json'), 'utf8');
  assert.doesNotMatch(serialized, /ghp_TEST_TOKEN/);
});
