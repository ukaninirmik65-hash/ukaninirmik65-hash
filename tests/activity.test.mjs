import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  currentStreak, fetchActivity, fetchAllPages, fetchLanguages, languageDistribution, normalizeActivity,
  normalizeInventory, parsePublicCalendar, publicRequest, requestGitHub,
} from '../scripts/profile-data.mjs';
import { assertSafeOutputs, replaceSections, updateProfile, validateProfile } from '../scripts/update-profile.mjs';

const API = 'https://api.github.com';
const OWNER = 'example';
const PERIOD = { from: '2026-01-01', to: '2026-01-03' };
const INSTANT = '2026-01-03T09:00:00.000Z';
const LATER = '2026-01-03T15:00:00.000Z';
const TOKEN = 'unit-test-credential-that-must-not-appear';
const SHA = '2'.repeat(40);
const sections = ['PROJECTS', 'STATS', 'ACTIVITY_OVERVIEW', 'LANGUAGES', 'RECENT_ACTIVITY', 'LAST_UPDATED'];
const readme = ['# My developer profile', ...sections.map(name => `<!-- ${name}:START -->\nOriginal ${name} text\n<!-- ${name}:END -->`), 'Manual footer', ''].join('\n\n');
const json = (value, options) => Response.json(value, options);

const calendarHTML = `
  <td data-date="2026-01-01" id="day-a" data-level="1"></td>
  <td data-date="2026-01-02" id="day-b" data-level="4"></td>
  <td data-date="2026-01-03" id="day-c" data-level="0"></td>
  <tool-tip for="day-b">1,234 contributions on January 2nd.</tool-tip>
  <tool-tip for="day-c">No contributions on January 3rd.</tool-tip>
  <tool-tip for="day-a">1 contribution on January 1st.</tool-tip>`;
const days = [
  { date: '2026-01-01', count: 1 },
  { date: '2026-01-02', count: 1234 },
  { date: '2026-01-03', count: 0 },
];

function repository(id, name, metadata = {}) {
  return {
    id, name, owner: { login: OWNER }, private: false, visibility: 'public', stargazers_count: 0,
    forks_count: 0, fork: false, archived: false, disabled: false, pushed_at: '2026-01-02T12:00:00Z',
    language: 'JavaScript', description: 'Existing application', topics: ['featured'], ...metadata,
  };
}

function contribution(nameWithOwner, totalCount, occurredAt, visibility = 'PUBLIC') {
  return { repository: { nameWithOwner, visibility }, contributions: { totalCount, nodes: [{ occurredAt }] } };
}

function graphResponse(overrides = {}) {
  return { data: { user: { login: OWNER, contributionsCollection: {
    restrictedContributionsCount: 0,
    contributionCalendar: { weeks: [{ contributionDays: days.map(({ date, count }) => ({ date, contributionCount: count })) }] },
    totalCommitContributions: 6,
    commitContributionsByRepository: [
      contribution('example/interface', 4, '2026-01-01T00:00:00Z'),
      contribution('collaborator/website', 2, '2026-01-02T00:00:00Z'),
    ],
    totalPullRequestContributions: 1,
    pullRequestContributionsByRepository: [contribution('EXAMPLE/interface', 1, '2026-01-02T14:00:00Z')],
    totalPullRequestReviewContributions: 0,
    pullRequestReviewContributionsByRepository: [],
    totalIssueContributions: 0,
    issueContributionsByRepository: [],
    ...overrides,
  } } } };
}

function mockRequest({ followers = 4, languagesOffline = false, badTitle = false } = {}) {
  return async (href, options) => {
    const { pathname, searchParams } = new URL(href);
    switch (pathname) {
      case '/users/example': return json({ login: OWNER, followers, public_repos: 1 });
      case '/users/example/repos': return json([repository(1, 'interface', { stargazers_count: 2 })]);
      case '/graphql': {
        assert.equal(options.token, TOKEN);
        const { query, variables } = JSON.parse(options.body);
        assert.match(query, /totalCommitContributions[\s\S]+totalPullRequestContributions[\s\S]+totalPullRequestReviewContributions[\s\S]+totalIssueContributions/);
        assert.equal(variables.from, '2026-01-01T00:00:00Z');
        assert.equal(variables.login, OWNER);
        return json(graphResponse());
      }
      case '/users/example/contributions': return new Response(calendarHTML);
      case '/repos/example/interface/languages':
        if (languagesOffline) throw Object.assign(new Error(`GitHub failed with ${TOKEN}`), { status: 503 });
        return json({ JavaScript: 3, CSS: 1 });
      case '/users/example/events/public': return json([]);
      case '/repos/example/interface/commits':
        assert.equal(searchParams.get('per_page'), '5');
        return json([{
          sha: SHA,
          author: { login: OWNER, type: 'User' },
          commit: { message: badTitle ? TOKEN : 'Improve accessible navigation', author: { date: '2026-01-02T12:00:00Z' }, committer: { date: '2026-01-02T12:00:00Z' } },
        }]);
      default: assert.fail(`Unexpected test request: ${pathname}`);
    }
  };
}

async function fixture(t, source = readme) {
  const root = await mkdtemp(join(tmpdir(), 'profile-pipeline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'README.md'), source);
  return { root, username: OWNER, token: TOKEN, now: INSTANT, request: mockRequest(), onWarning: () => {} };
}

test('pagination follows the Link header even when a repository page is short', async () => {
  const next = `${API}/users/example/repos?page=2`;
  const visited = [];
  const result = await fetchAllPages(`${API}/users/example/repos?per_page=100`, { request: async url => {
    visited.push(url);
    return visited.length === 1 ? json([{ id: 1 }], { headers: { link: `<${next}>; rel="next"` } }) : json([{ id: 2 }]);
  } });
  assert.deepEqual(result, [{ id: 1 }, { id: 2 }]);
  assert.equal(visited[1], next);
});

test('pagination rejects off-site redirects, cycles and repeated identifiers', async () => {
  const url = `${API}/users/example/repos`;
  for (const next of ['https://untrusted.example/steal', url]) {
    let calls = 0;
    await assert.rejects(fetchAllPages(url, { request: async () => {
      calls++;
      return json([{ id: 1 }], { headers: { link: `<${next}>; rel="next"` } });
    } }), /Unsafe or circular/);
    assert.equal(calls, 1);
  }
  await assert.rejects(fetchAllPages(url, { request: async () => json([{ id: '1' }, { id: '1' }]) }), /duplicate identifier/);
});

test('inventory totals count public repositories, including forks, while screening private data', () => {
  const input = [repository(1, 'interface', { stargazers_count: 3, secret: TOKEN }), repository(2, 'fork', { fork: true, stargazers_count: 2 }),
    repository(3, 'restricted-secret-name', { private: true, visibility: 'private', stargazers_count: 18 })];
  const model = normalizeInventory({ login: OWNER, followers: 0, public_repos: 2 }, input, OWNER);
  assert.deepEqual(model.stats, { repositories: 2, stars: 5, followers: 0 });
  assert.deepEqual(model.repositories.map(repo => repo.name), ['interface', 'fork']);
  assert.doesNotMatch(JSON.stringify(model), /restricted-secret-name|unit-test-credential/);
  assert.throws(() => normalizeInventory({ login: OWNER, followers: 0, public_repos: 3 }, input, OWNER), /Incomplete public repository inventory/);
});

test('language distribution uses real byte amounts and does not request excluded repositories', async () => {
  const requested = [];
  const result = await fetchLanguages(OWNER, [
    { name: 'application' }, { name: 'library' }, { name: 'fork', fork: true }, { name: 'archived', archived: true },
    { name: 'disabled', disabled: true }, { name: OWNER },
  ], async url => {
    requested.push(url);
    return json(url.includes('/application/') ? { JavaScript: 50, CSS: 30 } : { JavaScript: 20 });
  });
  assert.deepEqual(result, [{ name: 'JavaScript', bytes: 70, percentage: 70 }, { name: 'CSS', bytes: 30, percentage: 30 }]);
  assert.equal(requested.length, 2);
  assert.deepEqual(languageDistribution([{}, { CSS: 0 }]), []);
  assert.throws(() => languageDistribution([{ JavaScript: -1 }]), /Invalid repository language byte count/);
});

test('calendar parser joins tooltip counts to dates and rejects missing counts or date gaps', () => {
  assert.deepEqual(parsePublicCalendar(calendarHTML, PERIOD), days);
  assert.throws(() => parsePublicCalendar(calendarHTML.replace(/<tool-tip for="day-b">.*?<\/tool-tip>/, ''), PERIOD), /Invalid daily contribution count/);
  assert.throws(() => parsePublicCalendar(calendarHTML.replace(/<td data-date="2026-01-02".*?<\/td>/, ''), PERIOD), /incomplete/);
});

test('streak includes yesterday if today is empty and stops at the first missed day', () => {
  assert.equal(currentStreak(days, PERIOD.to), 2);
  assert.equal(currentStreak(days, '2026-01-04'), 0);
  assert.equal(currentStreak(days, '2026-01-02'), 2);
  assert.equal(currentStreak([], PERIOD.to), 0);
});

test('GitHub requests retry bounded temporary failures and avoid waiting on long rate limits', async () => {
  let attempts = 0;
  const waits = [];
  const response = await requestGitHub(`${API}/users/example`, {
    fetchImpl: async () => (++attempts < 3 ? new Response(null, { status: 503 }) : json({ login: OWNER })),
    sleep: async ms => { waits.push(ms); },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(waits, [250, 500]);
  await assert.rejects(requestGitHub(`${API}/users/example`, {
    fetchImpl: async () => new Response(null, { status: 429, headers: { 'retry-after': '60' } }),
    sleep: async () => assert.fail('Must defer a long rate-limit wait to a future run'),
  }), error => error.status === 429 && error.rateLimited === true);
});

test('requests never expose token or response bodies in errors and only authorize GitHub API calls', async () => {
  let attempts = 0;
  await assert.rejects(requestGitHub(`${API}/users/example`, {
    token: TOKEN,
    fetchImpl: async (_url, options) => {
      attempts++;
      assert.equal(options.headers.get('authorization'), `Bearer ${TOKEN}`);
      assert.equal(options.redirect, 'error');
      return new Response(TOKEN, { status: 401 });
    },
    sleep: async () => assert.fail('Authentication failures should not sleep'),
  }), error => error.status === 401 && !String(error).includes(TOKEN));
  assert.equal(attempts, 1);
  await requestGitHub('https://github.com/users/example/contributions', {
    token: TOKEN, headers: { Authorization: `Bearer ${TOKEN}` },
    fetchImpl: async (_url, options) => { assert.equal(options.headers.has('authorization'), false); return new Response(calendarHTML); },
  });
  await assert.rejects(requestGitHub('https://untrusted.example/steal', {
    token: TOKEN, fetchImpl: async () => assert.fail('Credentials must not be forwarded off site'),
  }), /Untrusted GitHub request origin/);
});

test('public repository requests can recover from insufficient Actions token access', async () => {
  const headers = [];
  const request = publicRequest(TOKEN, async (_url, options) => {
    headers.push(options.headers.get('authorization'));
    return headers.length === 1 ? new Response(null, { status: 403 }) : json({ public: true });
  });
  assert.deepEqual(await (await request(`${API}/repos/collaborator/website`)).json(), { public: true });
  assert.deepEqual(headers, [`Bearer ${TOKEN}`, null]);
});

test('GraphQL breakdown uses public grouped contributions and rejects incomplete totals', () => {
  const payload = graphResponse({ totalIssueContributions: 3, issueContributionsByRepository: [
    contribution('example/private-project', 3, '2026-01-02T20:00:00Z', 'PRIVATE'),
  ] });
  const result = normalizeActivity(payload, OWNER, PERIOD);
  assert.deepEqual(result.counts, { commits: 6, pullRequests: 1, reviews: 0, issues: 0 });
  assert.equal(result.canVerifyStreak, false);
  assert.deepEqual(result.repositories.map(repo => repo.name), ['EXAMPLE/interface', 'collaborator/website']);
  assert.doesNotMatch(JSON.stringify(result), /private-project/);
  assert.throws(() => normalizeActivity(graphResponse({ totalCommitContributions: 7 }), OWNER, PERIOD), /Incomplete GraphQL contribution breakdown/);
  assert.throws(() => normalizeActivity({ errors: [{ message: 'access denied' }] }, OWNER, PERIOD), /Invalid GitHub GraphQL/);
});

test('an unexplained mismatch with anonymous counts leaves the activity refresh unavailable', async () => {
  const request = async url => url.endsWith('/graphql') ? json(graphResponse()) : new Response(calendarHTML.replace('1,234', '1,233'));
  await assert.rejects(fetchActivity({ username: OWNER, period: PERIOD, now: INSTANT, tokens: [TOKEN], request }), /anonymous contribution dates or counts differ/);
});

test('a credential with broader visibility cannot lengthen the signed-out streak', async () => {
  const payload = graphResponse({ restrictedContributionsCount: 1,
    contributionCalendar: { weeks: [{ contributionDays: days.map(({ date, count }) => ({
      date, contributionCount: date === PERIOD.to ? 5 : count,
    })) }] },
  });
  const request = async url => url.endsWith('/graphql') ? json(payload) : new Response(calendarHTML);
  const result = await fetchActivity({ username: OWNER, period: PERIOD, now: INSTANT, tokens: [TOKEN], request });
  assert.equal(result.streak, 2);
  assert.equal('days' in result, false);
});

test('README replacement preserves manual text, supports CRLF and rejects duplicate or injected markers', () => {
  const source = 'Before\r\n<!-- STATS:START -->\r\nPrevious\r\n<!-- STATS:END -->\r\nAfter';
  assert.equal(replaceSections(source, { STATS: 'Verified' }), 'Before\r\n<!-- STATS:START -->\r\n\r\nVerified\r\n\r\n<!-- STATS:END -->\r\nAfter');
  assert.throws(() => replaceSections(source + '\r\n<!-- STATS:START -->', { STATS: 'Verified' }), /duplicated README markers/);
  assert.throws(() => replaceSections(source, { STATS: '<!-- LANGUAGES:START -->' }), /duplicated README markers/);
});

test('the update rejects bad markers before any request or file write', async t => {
  const source = readme.replace('<!-- STATS:END -->', '');
  const config = await fixture(t, source);
  await assert.rejects(updateProfile({ ...config, request: async () => assert.fail('No API request expected') }), /README markers/);
  assert.equal(await readFile(join(config.root, 'README.md'), 'utf8'), source);
  assert.deepEqual(await readdir(config.root), ['README.md']);
});

test('a successful repeat refresh leaves files and timestamps identical', async t => {
  const config = await fixture(t);
  const first = await updateProfile(config);
  assert.ok(first.changed > 0);
  assert.deepEqual(first.failed, []);
  assert.equal(first.model.lastSuccessfulAt, INSTANT);
  assert.equal(first.model.activity.data.streak, 2);
  assert.equal(first.model.stats.data.stars, 2);
  assert.equal(first.model.recent.data[0].title, 'Improve accessible navigation');
  const next = await updateProfile({ ...config, now: LATER });
  assert.equal(next.changed, 0);
  assert.deepEqual(next.model, first.model);
  assert.match(await readFile(join(config.root, 'README.md'), 'utf8'), /Manual footer/);
  await validateProfile(config.root, [TOKEN]);
});

test('a partial outage keeps the previous section date and complete refresh time', async t => {
  const config = await fixture(t);
  const first = await updateProfile(config);
  const warnings = [];
  const partial = await updateProfile({ ...config, now: LATER, request: mockRequest({ followers: 7, languagesOffline: true }), onWarning: message => warnings.push(message) });
  assert.deepEqual(partial.failed, ['languages']);
  assert.deepEqual(partial.model.languages, { ...first.model.languages, stale: true });
  assert.equal(partial.model.lastSuccessfulAt, INSTANT);
  assert.equal(partial.model.stats.observedAt, LATER);
  assert.equal(partial.model.stats.data.followers, 7);
  assert.match(warnings[0], /HTTP 503/);
  assert.doesNotMatch(warnings.join('\n'), /unit-test-credential/);
  await validateProfile(config.root, [TOKEN]);
  const recovered = await updateProfile({ ...config, now: LATER, request: mockRequest({ followers: 7 }) });
  assert.equal(recovered.model.languages.stale, false);
  assert.equal(recovered.model.lastSuccessfulAt, LATER);
});

test('credential screening rejects direct and token-shaped leaks before writing output', async t => {
  const config = await fixture(t);
  await assert.rejects(updateProfile({ ...config, request: mockRequest({ badTitle: true }) }), /credential screening/);
  assert.deepEqual(await readdir(config.root), ['README.md']);
  assert.throws(() => assertSafeOutputs({ readme: `ghp_${'A'.repeat(36)}` }), /credential screening/);
});
