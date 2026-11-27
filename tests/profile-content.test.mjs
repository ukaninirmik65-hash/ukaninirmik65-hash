import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchProjects, fetchRecentActivity, getRecentlyUpdatedProjects } from '../scripts/profile-content.mjs';

const OWNER = 'ukaninirmik65-hash';
const NOW = '2026-11-27T20:00:00Z';
const date = '2026-11-25T18:00:00Z';
const hash = 'a'.repeat(40);
const verified = 'https://erp-app-khaki.vercel.app/';
const json = value => Response.json(value);
const html = () => new Response('<h1>Demo</h1>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
const manifest = value => json({ type: 'file', encoding: 'base64', content: Buffer.from(JSON.stringify(value)).toString('base64') });

function repository(name, extra = {}) {
  return { name, description: 'A repository description', language: 'JavaScript', stars: 0, forks: 0, pushedAt: '2026-11-25', ...extra };
}

function commit({ title = 'Improve component keyboard navigation', login = OWNER, type = 'User', time = date, sha = hash, committer = login } = {}) {
  return { sha, commit: { message: title, author: { date: time }, committer: { date: time } }, author: { login, type }, committer: { login: committer } };
}

function event(type, payload, extra = {}) {
  return { type, payload, public: true, actor: { login: OWNER }, repo: { name: `${OWNER}/ERP-App` }, created_at: date, ...extra };
}

test('featured projects preserve curation and discover qualifying repositories while excluding irrelevant ones', async () => {
  const repositories = [
    repository('ERP-App', { forks: 2, homepage: 'https://invalid.example/', license: 'MIT', pushedAt: '2026-11-26' }),
    repository('Tetris-Game', { stars: 1 }),
    repository('NewProject', { topics: ['featured'] }),
    repository('StarredProject', { stars: 2 }),
    repository('draft'),
    repository('forked', { fork: true, stars: 9 }),
    repository('archived', { archived: true, stars: 9 }),
    repository('disabled', { disabled: true, stars: 9 }),
    repository('private', { private: true, stars: 9 }),
    repository(OWNER, { stars: 9 }),
    repository('motiwalaperfumes-clone', { stars: 9 }),
    repository('demo', { stars: 9 }),
  ];
  const probes = [];
  const result = await fetchProjects({
    username: OWNER, repositories,
    request: async url => {
      if (url.includes('/StarredProject/contents/package.json')) {
        return manifest({ dependencies: { react: '^19.0.0', 'react-router': '^7.0.0', 'react-router-dom': '^7.0.0', 'unrecognized-package': '1.0.0' },
          devDependencies: { vite: '^7.0.0' }, scripts: { build: 'next build' } });
      }
      if (url.endsWith('/contents/package.json')) throw Object.assign(new Error('Not found'), { status: 404 });
      return json([commit({ title: 'chore: refresh public profile activity', sha: 'b'.repeat(40) }), commit()]);
    },
    fetchImpl: async (url, options) => { probes.push(url); assert.equal(options.redirect, 'manual'); assert.equal(options.headers, undefined); return html(); },
  });
  assert.deepEqual(result.map(item => item.name), ['ERP-App', 'Tetris-Game', 'StarredProject', 'NewProject']);
  assert.equal(result[0].title, 'ERP Management Frontend');
  assert.equal(result[0].updatedAt, '2026-11-25');
  assert.equal(result[0].pushedAt, '2026-11-26');
  assert.equal(result[0].githubDescription, 'A repository description');
  assert.equal(result[0].license, 'MIT');
  assert.equal(result[0].forks, 2);
  assert.equal(result[0].demoUrl, verified);
  assert.ok(result[0].features.includes('Inventory views and chart-based reporting'));
  assert.deepEqual(result[2].stack, ['React.js', 'React Router', 'Vite']);
  assert.deepEqual(result[2].features, []);
  assert.equal(result[2].githubDescription, null);
  assert.equal(result[2].license, null);
  assert.deepEqual(result[3].stack, []);
  assert.equal(probes.length, 2);
});

test('discovered project manifest requests distinguish an unavailable API from unsupported source', async () => {
  const config = { username: OWNER, repositories: [repository('Discovered', { topics: ['featured'] })] };
  const [project] = await fetchProjects({ ...config, request: async url => {
    return url.endsWith('/contents/package.json') ? json({ type: 'dir' }) : json([]);
  } });
  assert.deepEqual(project.stack, []);
  await assert.rejects(fetchProjects({ ...config, request: async url => {
    if (url.endsWith('/contents/package.json')) throw Object.assign(new Error('Temporarily unavailable'), { status: 503 });
    return json([]);
  } }), /Temporarily unavailable/);
});

test('recently updated projects use UTC push dates and exclude profile automation and ineligible repositories', () => {
  const repositories = [
    repository('First', { pushedAtInstant: '2026-11-26T22:30:00-03:00' }),
    repository('Second', { pushedAtInstant: '2026-11-27T01:00:00Z' }),
    repository('NoTimestamp', { pushedAt: 'broken-date' }),
    repository('Third'), repository('Fourth', { pushedAt: '2026-11-24' }),
    repository('Fifth', { pushedAt: '2026-11-23' }), repository('Sixth', { pushedAt: '2026-11-22' }),
    repository(OWNER, { pushedAt: '2026-11-29' }), repository('Fork', { pushedAt: '2026-11-29', fork: true }),
    repository('Archived', { pushedAt: '2026-11-29', archived: true }), repository('Disabled', { pushedAt: '2026-11-29', disabled: true }),
    repository('Private', { pushedAt: '2026-11-29', private: true }),
  ];
  const rows = getRecentlyUpdatedProjects({ username: OWNER, repositories });
  assert.deepEqual(rows.map(row => row.name), ['First', 'Second', 'Third', 'Fourth', 'Fifth']);
  assert.deepEqual(rows[0], { name: 'First', url: `https://github.com/${OWNER}/First`, updatedAt: '2026-11-27' });
  assert.deepEqual(getRecentlyUpdatedProjects({ username: OWNER, repositories: [] }), []);
});

test('deployment probes retain previous verified URLs for temporary failures and omit dead links', async () => {
  const configuration = {
    username: OWNER, repositories: [repository('ERP-App')], request: async () => json([]),
    previousProjects: [{ name: 'ERP-App', demoUrl: verified }], onWarning: () => {},
  };
  const [stale] = await fetchProjects({ ...configuration, fetchImpl: async () => new Response(null, { status: 503 }) });
  const [broken] = await fetchProjects({ ...configuration, fetchImpl: async () => new Response(null, { status: 404 }) });
  const [newTemporary] = await fetchProjects({ ...configuration, previousProjects: [], fetchImpl: async () => { throw new Error('Network down'); } });
  assert.equal(stale.demoUrl, verified);
  assert.equal(stale.updatedAt, null);
  assert.equal(broken.demoUrl, null);
  assert.equal(newTemporary.demoUrl, null);
});

test('deployment probes refuse unsafe redirects even after a valid HTTPS starting URL', async () => {
  const urls = [];
  const [project] = await fetchProjects({
    username: OWNER, repositories: [repository('ERP-App')], request: async () => json([]),
    fetchImpl: async url => {
      urls.push(url);
      return new Response(null, { status: 301, headers: { location: 'http://127.0.0.1/private' } });
    },
  });
  assert.equal(project.demoUrl, null);
  assert.deepEqual(urls, [verified]);
});

test('public activity resolves modern push payloads, includes authored work, and deduplicates event links', async () => {
  const events = [
    event('PushEvent', { head: hash, ref: 'refs/heads/main' }, { created_at: '2026-11-27T18:00:00Z' }),
    event('PullRequestEvent', { action: 'closed', pull_request: { number: 21, title: 'Improve focus order', merged: true } }, { created_at: '2026-11-27T17:00:00Z' }),
    event('PullRequestEvent', { action: 'opened', pull_request: { number: 21, title: 'Improve focus order' } }),
    event('ReleaseEvent', { action: 'published', release: { tag_name: 'release/1.2', name: 'Release 1.2', draft: false } }),
    event('IssuesEvent', { action: 'opened', issue: { number: 12, title: 'Document filter edge case' } }),
    event('IssuesEvent', { action: 'opened', issue: { number: 30, title: 'Private data' } }, { public: false }),
    event('IssuesEvent', { action: 'opened', issue: { number: 99, title: 'Automation data' } }, { repo: { name: `${OWNER}/${OWNER}` } }),
    event('IssuesEvent', { action: 'opened', issue: { number: 222, title: 'Other actor' } }, { actor: { login: 'generated[bot]' } }),
  ];
  const requests = [];
  const result = await fetchRecentActivity({
    username: OWNER, repositories: [repository('ERP-App')], now: NOW,
    fetchAllPages: async url => { assert.match(url, /\/events\/public\?per_page=100$/); return events; },
    request: async url => {
      requests.push(url);
      if (url.endsWith(hash)) return json(commit());
      return json([commit(), commit({ title: 'Add tests for inventory sorting', sha: 'b'.repeat(40) })]);
    },
  });
  assert.equal(requests.length, 2);
  assert.match(requests[1], /\?author=ukaninirmik65-hash&since=/);
  assert.deepEqual(result.map(entry => entry.kind), ['Commit', 'Pull request', 'Commit', 'Issue', 'Release']);
  assert.deepEqual(result.filter(entry => entry.kind === 'Pull request').map(entry => entry.date), ['2026-11-27']);
  assert.match(result.find(entry => entry.kind === 'Release').url, /release%2F1\.2$/);
  assert.equal(result.filter(entry => entry.title === 'Improve component keyboard navigation').length, 1);
  assert.equal(result.length, 5);
});

test('public history fallback ignores unaffiliated commits, automation and out-of-window entries', async () => {
  const commits = [
    commit({ title: 'Unmapped author', login: null }),
    commit({ title: 'Bot commit', login: OWNER, type: 'Bot', sha: 'b'.repeat(40) }),
    commit({ title: 'Authored commit with bot committer', committer: 'github-actions[bot]', sha: 'c'.repeat(40) }),
    commit({ title: 'chore(profile): refresh public profile activity', sha: 'd'.repeat(40) }),
    commit({ title: 'Old change', time: '2026-01-01T00:00:00Z', sha: 'e'.repeat(40) }),
    commit({ title: 'Real title\n\nLong description', sha: 'f'.repeat(40) }),
  ];
  const result = await fetchRecentActivity({
    username: OWNER, repositories: [repository('ERP-App')], now: NOW, fetchAllPages: async () => [], request: async () => json(commits),
  });
  assert.deepEqual(result.map(entry => entry.title), ['Real title']);
});

test('recent activity checks that old event repository links are still public', async () => {
  const issue = (repo, number) => event('IssuesEvent', { action: 'opened', issue: { number, title: 'Record keyboard navigation issue' } }, { repo: { name: repo } });
  const requests = [];
  const result = await fetchRecentActivity({
    username: OWNER, repositories: [], now: NOW,
    fetchAllPages: async () => [
      issue(`${OWNER}/previously-public`, 1), issue('contributor/public-repo', 1),
      issue('contributor/public-repo', 2), issue('contributor/no-longer-public', 1), issue('contributor/removed', 1),
    ],
    request: async url => {
      requests.push(url);
      if (url.endsWith('/removed')) throw Object.assign(new Error('Not found'), { status: 404 });
      const isPrivate = url.endsWith('/no-longer-public');
      return json({ private: isPrivate, visibility: isPrivate ? 'private' : 'public' });
    },
  });
  assert.deepEqual(result.map(entry => entry.repo), ['contributor/public-repo', 'contributor/public-repo']);
  assert.equal(requests.length, 3);
});

test('empty repositories and unavailable API responses have different outcomes', async () => {
  const configuration = { username: OWNER, repositories: [repository('ERP-App')], now: NOW, fetchAllPages: async () => [] };
  const request = async () => { throw new Error('GitHub request failed (HTTP 409)'); };
  assert.deepEqual(await fetchRecentActivity({ ...configuration, request }), []);
  await assert.rejects(fetchRecentActivity({ ...configuration, request: async () => { throw new Error('GitHub request failed (HTTP 503)'); } }), /HTTP 503/);
  await assert.rejects(fetchRecentActivity({ ...configuration, request: async () => json({ message: 'not a commit list' }) }), /Invalid repository commit response/);
});
