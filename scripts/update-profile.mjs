import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  currentStreak, dateKey, fetchActivity, fetchAllPages, fetchInventory, fetchLanguages,
  integer, previousYearPeriod, publicRequest, requestGitHub, validateCalendar,
} from './profile-data.mjs';
import { fetchProjects, fetchRecentActivity, getRecentlyUpdatedProjects } from './profile-content.mjs';
import { renderAssets, renderReadmeSections } from './profile-render.mjs';

const DEFAULT_USER = 'ukaninirmik65-hash';
const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotPath = 'assets/profile-data.json';
const sectionNames = ['projects', 'stats', 'activity', 'languages', 'recent', 'recentRepositories'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalizedText = value => value?.replaceAll('\r\n', '\n');
const isoDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && [new Date(value).toISOString(), dateKey(value)].includes(value);

const emptySection = () => ({ data: null, observedAt: null, stale: false });
const savedSection = (data, observedAt, stale = false) => ({ data, observedAt, stale });

function migrateSnapshot(previous, username) {
  const empty = { version: 2, username, lastSuccessfulAt: null,
    ...Object.fromEntries(sectionNames.map(name => [name, emptySection()])) };
  if (!previous || previous.username?.toLowerCase() !== username.toLowerCase()) return empty;
  if (previous.version === 2) return { recentRepositories: emptySection(), ...previous };
  if (previous.version !== 1) throw new Error('Unsupported profile snapshot version');
  const stats = { repositories: previous.totals?.total, stars: previous.totals?.stars, followers: previous.followers };
  if (Object.values(stats).every(integer) && isoDate(previous.observedAt)) {
    empty.stats = savedSection(stats, previous.observedAt, true);
  }
  const old = previous.contributions;
  if (old?.source === 'public-calendar' && isoDate(old.to)) {
    const { commits, pullRequests, reviews, issues } = old.metrics || {};
    const counts = { commits, pullRequests, reviews, issues };
    if (Object.values(counts).every(integer)) {
      const days = validateCalendar(old.days, old);
      empty.activity = savedSection({ from: old.from, to: old.to, counts,
        streak: currentStreak(days, old.to), repositories: null }, old.to, true);
    }
  }
  return empty;
}

export function replaceSections(readme, sections) {
  const eol = readme.includes('\r\n') ? '\r\n' : '\n';
  const lines = readme.split(eol);
  let previousEnd = -1;
  for (const [key, content] of Object.entries(sections)) {
    const start = `<!-- ${key}:START -->`;
    const end = `<!-- ${key}:END -->`;
    const beginIndex = lines.indexOf(start);
    const endIndex = lines.indexOf(end);
    if (beginIndex <= previousEnd || endIndex <= beginIndex || lines.lastIndexOf(start) !== beginIndex
      || lines.lastIndexOf(end) !== endIndex || /<!-- [A-Z_]+:(?:START|END) -->/.test(content)) {
      throw new Error(`Invalid or duplicated README markers for ${key}`);
    }
    const replacement = ['', ...content.split('\n'), ''];
    lines.splice(beginIndex + 1, endIndex - beginIndex - 1, ...replacement);
    previousEnd = beginIndex + replacement.length + 1;
  }
  return lines.join(eol);
}

function checkSnapshot(model) {
  if (model.version !== 2 || !/^[a-z0-9-]{1,39}$/i.test(model.username)
    || (model.lastSuccessfulAt !== null && !isoDate(model.lastSuccessfulAt))) throw new Error('Invalid profile snapshot');
  for (const name of sectionNames) {
    const section = model[name];
    if (!section || typeof section.stale !== 'boolean'
      || (section.data === null ? section.observedAt !== null || section.stale : !isoDate(section.observedAt))) {
      throw new Error(`Invalid ${name} snapshot`);
    }
  }
}

export function assertSafeOutputs(outputs, credentials = []) {
  const tokenPattern = /\b(?:gh[pousr]_[a-z\d]{30,}|github_pat_[a-z\d_]{30,})\b/i;
  for (const content of Object.values(outputs)) {
    if (tokenPattern.test(content) || credentials.some(token => token?.length >= 8 && content.includes(token))) {
      throw new Error('Generated content failed credential screening');
    }
  }
}

function renderOutputs(readme, model) {
  checkSnapshot(model);
  const assets = Object.fromEntries(Object.entries(renderAssets(model)).map(([name, svg]) => [`assets/${name}`, svg]));
  return { ...assets, 'README.md': replaceSections(readme, renderReadmeSections(model)),
    [snapshotPath]: `${JSON.stringify(model, null, 2)}\n` };
}

async function readOptional(filename) {
  try {
    return await readFile(filename, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function publishOutputs(root, outputs) {
  const suffix = `.${randomUUID()}.tmp`;
  const pending = [];
  try {
    for (const [name, content] of Object.entries(outputs)) {
      const filename = path.join(root, name);
      const original = await readOptional(filename);
      if (normalizedText(original) === normalizedText(content)) continue;
      const temporary = filename + suffix;
      pending.push({ filename, temporary, original, written: false });
      await mkdir(path.dirname(filename), { recursive: true });
      await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' });
    }
    for (const item of pending) {
      await rename(item.temporary, item.filename);
      item.written = true;
    }
  } catch (error) {
    for (const item of pending.filter(entry => entry.written)) {
      if (item.original === null) await rm(item.filename, { force: true });
      else {
        await writeFile(item.temporary, item.original, 'utf8');
        await rename(item.temporary, item.filename);
      }
    }
    throw error;
  } finally {
    await Promise.all(pending.map(item => rm(item.temporary, { force: true })));
  }
  return pending.length;
}

function legacyRepositoryLinks(previous, recent, today) {
  const data = previous.activity.data;
  if (!data || data.repositories !== null || data.to.slice(0, 4) !== today.slice(0, 4) || !recent.data) return previous.activity;
  const repos = new Map();
  for (const entry of recent.data) {
    if (entry.date < data.from || entry.date > data.to || !['Commit', 'Pull request', 'Issue'].includes(entry.kind)) continue;
    repos.set(entry.repo, { name: entry.repo, url: `https://github.com/${entry.repo}` });
  }
  return repos.size ? { ...previous.activity, data: { ...data, repositories: [...repos.values()] } } : previous.activity;
}

export async function updateProfile({
  username = DEFAULT_USER, root = DEFAULT_ROOT, now = new Date(), token, profileToken, request, fetchImpl = fetch,
  onWarning = console.warn,
} = {}) {
  if (!/^[a-z0-9-]{1,39}$/i.test(username)) throw new Error('Invalid GitHub username');
  const instant = new Date(now).toISOString();
  const today = dateKey(instant);
  const period = { from: `${today.slice(0, 4)}-01-01`, to: today };
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const stored = JSON.parse(await readOptional(path.join(root, snapshotPath)) || 'null');
  const previous = migrateSnapshot(stored, username);
  checkSnapshot(previous);
  // Check all markers before making any API requests or modifying generated output.
  replaceSections(readme, renderReadmeSections(previous));
  const tokens = [...new Set([token, profileToken].filter(Boolean))];
  const get = request || publicRequest(token, fetchImpl);
  const graph = request || ((url, options) => requestGitHub(url, { fetchImpl, ...options }));
  const inventory = fetchInventory(username, get);
  const failed = [];

  async function section(name, load) {
    try {
      const data = await load();
      const unchanged = same(data, previous[name].data);
      return savedSection(data, unchanged ? previous[name].observedAt : instant);
    } catch (error) {
      failed.push(name);
      const status = integer(error?.status) ? ` (HTTP ${error.status}${error.rateLimited ? ', rate limited' : ''})` : '';
      const graphErrors = [
        'GitHub GraphQL credentials are missing', 'Invalid GitHub GraphQL contribution response',
        'Incomplete GraphQL contribution breakdown', 'GraphQL and anonymous contribution dates or counts differ',
      ];
      const reason = name === 'activity' && graphErrors.includes(error?.message) ? ` ${error.message}.` : '';
      onWarning(`Profile ${name} could not refresh${status}.${reason} Preserving verified data where available.`);
      return { ...previous[name], stale: previous[name].data !== null };
    }
  }

  const [projects, stats, fetchedActivity, languages, recent, recentRepositories] = await Promise.all([
    section('projects', async () => fetchProjects({ username, repositories: (await inventory).repositories, request: get,
      fetchImpl, previousProjects: previous.projects.data || [], onWarning })),
    section('stats', async () => (await inventory).stats),
    section('activity', async () => {
      const data = await fetchActivity({ username, period, now: instant, tokens, request: graph, onWarning });
      const prior = previous.activity.data;
      const comparison = previousYearPeriod(period);
      const cached = prior?.previousYear?.from === comparison.from && prior.previousYear.to === comparison.to
        ? prior.previousYear : null;
      const history = data.previousYear ?? cached;
      return { ...data, previousYear: history,
        previousYearObservedAt: history && (same(history, cached) ? prior?.previousYearObservedAt || instant : instant),
        previousYearStale: !data.previousYear && !!cached,
      };
    }),
    section('languages', async () => fetchLanguages(username, (await inventory).repositories, get)),
    section('recent', async () => fetchRecentActivity({ username, repositories: (await inventory).repositories,
      request: get, fetchAllPages, now: instant })),
    section('recentRepositories', async () => getRecentlyUpdatedProjects({ username, repositories: (await inventory).repositories })),
  ]);
  const activity = stored?.version === 1 && fetchedActivity.stale ? legacyRepositoryLinks(previous, recent, today) : fetchedActivity;
  const model = { version: 2, username, lastSuccessfulAt: previous.lastSuccessfulAt, projects, stats, activity, languages, recent, recentRepositories };
  if (!failed.length && (!model.lastSuccessfulAt || sectionNames.some(name => !same(model[name], previous[name])))) {
    model.lastSuccessfulAt = instant;
  }
  const outputs = renderOutputs(readme, model);
  assertSafeOutputs(outputs, tokens);
  const changed = await publishOutputs(root, outputs);
  return { model, changed, failed: sectionNames.filter(name => failed.includes(name)) };
}

export async function validateProfile(root = DEFAULT_ROOT, credentials = []) {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const model = JSON.parse(await readFile(path.join(root, snapshotPath), 'utf8'));
  const expected = renderOutputs(readme, model);
  assertSafeOutputs(expected, credentials);
  for (const [filename, content] of Object.entries(expected)) {
    const actual = await readFile(path.join(root, filename), 'utf8');
    if (normalizedText(actual) !== normalizedText(content)) throw new Error(`Generated ${filename} is out of sync`);
  }
}

async function main() {
  const { GITHUB_TOKEN: token, PROFILE_TOKEN: profileToken, PROFILE_USERNAME: username } = process.env;
  try {
    if (process.argv[2] === '--validate') {
      await validateProfile(DEFAULT_ROOT, [token, profileToken]);
      console.log('README markers and generated assets match the public snapshot.');
      return;
    }
    const { changed, failed } = await updateProfile({ username, token, profileToken });
    console.log(`Profile update produced ${changed} file change(s). ${failed.length} section(s) could not refresh.`);
    if (failed.length) process.exitCode = 2;
  } catch {
    // An unexpected exception may contain a remote response fragment or credential.
    console.error('Profile update stopped. Check local files, README markers, and generated snapshot consistency.');
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
