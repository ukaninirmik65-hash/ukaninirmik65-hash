import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
const DAY = 86_400_000;
const DEFAULT_USER = 'ukaninirmik65-hash';
const palette = ['#17243A', '#165E63', '#22B8AD', '#22D3EE', '#A78BFA'];
const dateKey = date => new Date(date).toISOString().slice(0, 10);
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const num = value => new Intl.NumberFormat('en-US').format(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Never retry for longer than two seconds; a later scheduled run can recover. */
export async function requestGitHub(url, { token, fetchImpl = fetch, sleep = pause, maxAttempts = 3, ...options } = {}) {
  const target = new URL(url);
  if (!['https://api.github.com', 'https://github.com'].includes(target.origin)) throw new Error('Untrusted GitHub API origin');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        signal: AbortSignal.timeout(20_000),
        headers: {
          'User-Agent': 'Nirmik-Profile-Activity',
          Accept: target.hostname === 'api.github.com' ? 'application/vnd.github+json' : 'text/html',
          ...(target.hostname === 'api.github.com' ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
          ...(target.hostname === 'api.github.com' && token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });
    } catch {
      if (attempt === maxAttempts - 1) throw new Error('GitHub connection failed after bounded retries');
      await sleep(250 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response;
    const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')));
    const retryable = limited || response.status >= 500;
    const retrySeconds = Number(response.headers.get('retry-after') || 0);
    if (!retryable || attempt === maxAttempts - 1 || retrySeconds > 2) throw new Error(`GitHub request failed (HTTP ${response.status})`);
    await sleep(Math.max(retrySeconds * 1000, 250 * 2 ** attempt));
  }
  throw new Error('GitHub request failed');
}

export async function fetchAllPages(url, { request = requestGitHub } = {}) {
  const items = [];
  const seen = new Set();
  let next = url;
  while (next) {
    const target = new URL(next);
    if (target.origin !== API || seen.has(next)) throw new Error('Unsafe or circular API pagination');
    seen.add(next);
    const response = await request(next);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Expected a paginated repository array');
    items.push(...page);
    next = null;
    for (const link of (response.headers.get('link') || '').split(',')) {
      const match = link.match(/<([^>]+)>;\s*rel="next"/);
      if (match) next = match[1];
    }
  }
  const ids = items.map(item => item.id);
  if (new Set(ids).size !== ids.length) throw new Error('Repository pagination changed during collection; try again');
  return items;
}

/** Exact tooltip counts only: data-level is a color bucket, never a count. */
export function parseContributionHTML(html, { from, to }) {
  const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  const counts = new Map();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/g)) {
    const content = match[2].replace(/<[^>]*>/g, '').trim();
    const count = content.match(/^(No|[\d,]+) contributions? on /);
    const id = attr(match[1], 'for');
    if (id && count) counts.set(id, count[1] === 'No' ? 0 : Number(count[1].replaceAll(',', '')));
  }
  const days = [];
  for (const match of html.matchAll(/<td\b([^>]*)>/g)) {
    const date = attr(match[1], 'data-date');
    if (!date || date < from || date > to) continue;
    const count = counts.get(attr(match[1], 'id'));
    if (!integer(count)) throw new Error('Public calendar changed: exact contribution count is missing');
    days.push({ date, count });
  }
  return validateCalendar({ source: 'public-calendar', from, to, days });
}

export function validateCalendar(calendar) {
  const days = [...calendar.days].sort((a, b) => a.date.localeCompare(b.date));
  const expected = Math.round((Date.parse(calendar.to) - Date.parse(calendar.from)) / DAY) + 1;
  if (expected < 1 || days.length !== expected) throw new Error('Contribution calendar is incomplete');
  for (let index = 0; index < days.length; index++) {
    if (days[index].date !== dateKey(Date.parse(calendar.from) + index * DAY) || !integer(days[index].count)) throw new Error('Contribution dates or counts are invalid');
  }
  return { ...calendar, days, total: days.reduce((sum, day) => sum + day.count, 0) };
}

const graphQuery = `query ProfileActivity($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) { contributionsCollection(from: $from, to: $to) {
    contributionCalendar { weeks { contributionDays { date contributionCount } } }
    totalRepositoriesWithContributedCommits
    commitContributionsByRepository(maxRepositories: 100) { repository { isPrivate } contributions { totalCount } }
    pullRequestContributions(first: 100) { pageInfo { hasNextPage } nodes { isRestricted pullRequest { repository { isPrivate } } } }
    issueContributions(first: 100) { pageInfo { hasNextPage } nodes { isRestricted issue { repository { isPrivate } } } }
    pullRequestReviewContributions(first: 100) { pageInfo { hasNextPage } nodes { isRestricted pullRequestReview { pullRequest { repository { isPrivate } } } } }
  } }
}`;

/** Metrics are counted only in explicitly public repositories. Truncated metrics are omitted. */
export function normalizeGraphQL(payload, { from, to }) {
  if (payload.errors?.length || !payload.data?.user?.contributionsCollection) throw new Error('Contribution API unavailable');
  const collection = payload.data.user.contributionsCollection;
  const days = collection.contributionCalendar.weeks.flatMap(week => week.contributionDays)
    .filter(day => day.date >= from && day.date <= to).map(day => ({ date: day.date, count: day.contributionCount }));
  const metrics = {};
  if (integer(collection.totalRepositoriesWithContributedCommits) && collection.totalRepositoriesWithContributedCommits <= 100) {
    if (!Array.isArray(collection.commitContributionsByRepository) || collection.commitContributionsByRepository.some(item => !integer(item.contributions?.totalCount))) throw new Error('Invalid public commit contribution counts');
    metrics.commits = collection.commitContributionsByRepository.filter(item => item.repository?.isPrivate === false)
      .reduce((sum, item) => sum + item.contributions.totalCount, 0);
  }
  const connections = [
    ['pullRequests', collection.pullRequestContributions, node => node.pullRequest?.repository],
    ['issues', collection.issueContributions, node => node.issue?.repository],
    ['reviews', collection.pullRequestReviewContributions, node => node.pullRequestReview?.pullRequest?.repository],
  ];
  for (const [name, connection, repo] of connections) {
    if (connection && connection.pageInfo?.hasNextPage === false) {
      if (!Array.isArray(connection.nodes)) throw new Error('Invalid public contribution breakdown');
      metrics[name] = connection.nodes.filter(node => !node.isRestricted && repo(node)?.isPrivate === false).length;
    }
  }
  return validateCalendar({ source: 'graphql', from, to, days, metrics });
}

export function summarizeRepositories(repositories) {
  const publicRepos = repositories.filter(repo => !repo.private);
  return {
    total: publicRepos.length,
    stars: publicRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0),
    forks: publicRepos.reduce((sum, repo) => sum + repo.forks_count, 0),
    originals: publicRepos.filter(repo => !repo.fork).length,
    active: publicRepos.filter(repo => !repo.archived).length,
  };
}

export function calculateStreaks(days, today) {
  const sorted = [...days].filter(day => day.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  let longest = 0;
  let run = 0;
  let previous;
  for (const day of sorted) {
    run = day.count > 0 ? (previous && Date.parse(day.date) - Date.parse(previous) === DAY ? run + 1 : 1) : 0;
    longest = Math.max(longest, run);
    previous = day.date;
  }
  const counts = new Map(sorted.map(day => [day.date, day.count]));
  let cursor = today;
  if (!counts.get(cursor)) cursor = dateKey(Date.parse(cursor) - DAY);
  let current = 0;
  while (counts.get(cursor) > 0) {
    current++;
    cursor = dateKey(Date.parse(cursor) - DAY);
  }
  return { current, longest };
}

export function buildModel({ user, repositories, languages, contributions, previous, today }) {
  if (!integer(user.followers)) throw new Error('Follower count is unavailable');
  if (previous?.username?.toLowerCase() !== user.login?.toLowerCase()) previous = null;
  const publicRepos = repositories.filter(repo => !repo.private).sort((a, b) => a.name.localeCompare(b.name));
  const repos = publicRepos.map(repo => {
    if (![repo.stargazers_count, repo.forks_count].every(integer)) throw new Error('Invalid repository totals');
    return { name: repo.name, stars: repo.stargazers_count, forks: repo.forks_count, fork: repo.fork, archived: repo.archived, pushedAt: repo.pushed_at?.slice(0, 10) || null, language: repo.language || null };
  });
  const snapshot = { username: user.login, followers: user.followers, repositories: repos, totals: summarizeRepositories(publicRepos) };
  const previousSnapshot = previous && Object.fromEntries(Object.keys(snapshot).map(key => [key, previous[key]]));
  const observedAt = same(snapshot, previousSnapshot) ? previous.observedAt : today;
  return {
    version: 1,
    ...snapshot,
    observedAt,
    languages: languages || previous?.languages || null,
    contributions: contributions || previous?.contributions || null,
  };
}

function svg(width, height, title, description, content) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc"><title id="title">${esc(title)}</title><desc id="desc">${esc(description)}</desc><defs><linearGradient id="accent" x2="1" y2="1"><stop stop-color="#22D3EE"/><stop offset="1" stop-color="#A78BFA"/></linearGradient></defs><style>text{font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;fill:#F8FAFC}.muted{fill:#94A3B8}.cyan{fill:#22D3EE}.purple{fill:#A78BFA}.small{font-size:11px}.label{font-size:12px;fill:#94A3B8}.value{font-size:27px;font-weight:700}.title{font-size:20px;font-weight:700}</style><rect width="${width}" height="${height}" rx="20" fill="#0B1120"/><rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="19.5" fill="none" stroke="#233149"/>${content}</svg>\n`;
}

function txt(x, y, value, cls = '', extra = '') { return `<text x="${x}" y="${y}"${cls ? ` class="${cls}"` : ''}${extra ? ` ${extra}` : ''}>${esc(value)}</text>`; }
function line(x1, y1, x2, y2) { return `<path d="M${x1} ${y1}H${x2}" stroke="#233149"/>`; }
function monthSeries(calendar) {
  return Array.from({ length: Number(calendar.to.slice(5, 7)) }, (_, index) => ({ label: new Date(Date.UTC(2020, index, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), value: calendar.days.filter(day => Number(day.date.slice(5, 7)) === index + 1).reduce((sum, day) => sum + day.count, 0) }));
}
function weekSeries(calendar) {
  const end = Date.parse(calendar.to);
  return Array.from({ length: 8 }, (_, index) => {
    const start = end - (7 - index) * 7 * DAY - 6 * DAY;
    return { label: dateKey(start).slice(5), value: calendar.days.filter(day => Date.parse(day.date) >= start && Date.parse(day.date) <= start + 6 * DAY).reduce((sum, day) => sum + day.count, 0) };
  });
}
function bars(series, x, y, width, height, labelEvery = 1) {
  const max = Math.max(...series.map(item => item.value), 1);
  const slot = width / series.length;
  return series.map((item, index) => {
    const h = item.value / max * height;
    return `<g><title>${esc(item.label)}: ${item.value} contributions</title><rect x="${(x + index * slot + 3).toFixed(1)}" y="${(y + height - h).toFixed(1)}" width="${Math.max(slot - 8, 3).toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${index % 2 ? '#A78BFA' : '#22D3EE'}" opacity=".85"/>${txt(x + index * slot + slot / 2, y + height + 17, index % labelEvery === 0 ? item.label : '', 'muted small', 'text-anchor="middle"')}${item.value ? txt(x + index * slot + slot / 2, y + height - h - 5, num(item.value), 'small', 'text-anchor="middle"') : ''}</g>`;
  }).join('') + line(x, y + height + 1, x + width, y + height + 1);
}

function dashboard(model, mobile = false) {
  const width = mobile ? 420 : 900;
  const calendar = model.contributions;
  const metrics = [['Public repositories', model.totals.total], ['Stars received', model.totals.stars], ['Forks received', model.totals.forks], ['Followers', model.followers]];
  if (calendar) metrics.push(['Contributions · YTD', calendar.total]);
  for (const [key, label] of [['commits', 'Public commits · YTD'], ['pullRequests', 'Pull requests · YTD'], ['issues', 'Issues · YTD'], ['reviews', 'Code reviews · YTD']]) {
    if (integer(calendar?.metrics?.[key])) metrics.push([label, calendar.metrics[key]]);
  }
  const metricRows = Math.ceil(metrics.length / 2);
  const chartY = mobile ? 98 + metricRows * 72 : 110;
  const chartX = mobile ? 28 : 410;
  const chartWidth = mobile ? 364 : 458;
  const repoY = mobile ? chartY + 300 : Math.max(420, 110 + metricRows * 72);
  const height = repoY + 170;
  let c = txt(28, 38, 'Activity overview', 'title') + txt(28, 62, `@${model.username} · publicly visible activity`, 'label');
  c += `<rect x="28" y="78" width="42" height="3" rx="1.5" fill="url(#accent)"/>`;
  metrics.forEach(([label, value], index) => {
    const x = 28 + (index % 2) * (mobile ? 184 : 180);
    const y = 118 + Math.floor(index / 2) * 72;
    c += txt(x, y, num(value), index === 4 ? 'value cyan' : 'value') + txt(x, y + 21, label, 'label');
  });
  if (calendar) {
    c += txt(chartX, chartY, `Monthly contributions · ${calendar.from.slice(0, 4)}`, 'label');
    c += bars(monthSeries(calendar), chartX, chartY + 30, chartWidth, 85, mobile ? 2 : 1);
    c += txt(chartX, chartY + 170, 'Weekly contributions · last 8 rolling weeks', 'label');
    c += bars(weekSeries(calendar), chartX, chartY + 200, chartWidth, 55, mobile ? 2 : 1);
  } else c += txt(chartX, chartY, 'Contribution API unavailable · metrics omitted', 'label');
  c += line(28, repoY - 15, width - 28, repoY - 15) + txt(28, repoY + 8, 'Repository pulse', 'label');
  const recent = [...model.repositories].filter(repo => repo.pushedAt).sort((a, b) => b.pushedAt.localeCompare(a.pushedAt) || a.name.localeCompare(b.name)).slice(0, 3);
  recent.forEach((repo, index) => {
    const y = repoY + 36 + index * 25;
    const name = repo.name.length > (mobile ? 29 : 45) ? repo.name.slice(0, mobile ? 27 : 43) + '…' : repo.name;
    c += txt(28, y, name, 'small') + txt(width - 28, y, `push ${repo.pushedAt}`, 'muted small', 'text-anchor="end"');
  });
  c += txt(28, height - 28, `${model.totals.originals} original repos · ${model.totals.active} non-archived · snapshot ${model.observedAt}`, 'muted small');
  if (calendar) c += txt(28, height - 10, `Calendar ${calendar.from} → ${calendar.to} · public profile counts`, 'muted small');
  return svg(width, height, 'Nirmik Ukani — GitHub activity overview', 'Real public repository totals, publicly visible contributions by month and week, and latest repository push dates. Weekly buckets end on the calendar snapshot date and are clipped to the calendar year; the current month is partial.', c);
}

function graph(model, mobile = false) {
  const calendar = model.contributions;
  if (!calendar) return svg(900, 140, 'Contribution calendar unavailable', 'The contribution API did not return reliable data.', txt(28, 50, 'Contribution calendar unavailable', 'title') + txt(28, 85, 'A later successful refresh will populate this panel.', 'label'));
  const width = mobile ? 420 : 900;
  const startWeekday = new Date(calendar.from + 'T00:00:00Z').getUTCDay();
  const weeks = Math.ceil((calendar.days.length + startWeekday) / 7);
  const columns = mobile ? 27 : 53;
  const panels = Math.ceil(weeks / columns);
  const cell = mobile ? 11 : 12;
  const step = mobile ? 13 : 15;
  const panelHeight = 130;
  const height = 118 + panels * panelHeight;
  const max = Math.max(...calendar.days.map(day => day.count), 1);
  let c = txt(28, 38, `${calendar.from.slice(0, 4)} contribution history`, 'title') + txt(28, 62, `${num(calendar.total)} contributions · ${calendar.from} → ${calendar.to}`, 'label');
  for (let panel = 0; panel < panels; panel++) {
    const top = 102 + panel * panelHeight;
    c += txt(27, top + step + 9, 'M', 'muted small') + txt(27, top + step * 3 + 9, 'W', 'muted small') + txt(27, top + step * 5 + 9, 'F', 'muted small');
    let previousMonth = -1;
    calendar.days.forEach((day, index) => {
      const week = Math.floor((index + startWeekday) / 7);
      if (Math.floor(week / columns) !== panel) return;
      const column = week % columns;
      const weekday = (index + startWeekday) % 7;
      const x = 48 + column * step;
      const y = top + weekday * step;
      const bucket = day.count === 0 ? 0 : Math.min(4, 1 + Math.floor((day.count - 1) / Math.max(1, max / 4)));
      c += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" fill="${palette[bucket]}"><title>${day.date}: ${num(day.count)} contributions</title></rect>`;
      const month = Number(day.date.slice(5, 7));
      if ((day.date.endsWith('-01') || (index === 0 && panel === 0)) && month !== previousMonth) {
        c += txt(x, top - 10, new Date(day.date + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }), 'muted small');
        previousMonth = month;
      }
    });
  }
  const bottom = height - 24;
  c += txt(28, bottom, 'Public GitHub calendar', 'muted small');
  c += txt(width - 162, bottom, 'Less', 'muted small');
  palette.forEach((fill, i) => { c += `<rect x="${width - 130 + i * 15}" y="${bottom - 10}" width="11" height="11" rx="2" fill="${fill}"/>`; });
  c += txt(width - 23, bottom, 'More', 'muted small', 'text-anchor="end"');
  return svg(width, height, `${calendar.from.slice(0, 4)} contribution calendar for ${model.username}`, 'Exact publicly displayed GitHub daily contribution counts. Colors indicate relative intensity. GitHub’s native profile is authoritative; no private repository details are collected.', c);
}

function languageCard(model, mobile = false) {
  const width = mobile ? 420 : 900;
  const height = mobile ? 440 : 260;
  const languageData = model.languages;
  const entries = Object.entries(languageData?.bytes || {}).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
  const colors = ['#22D3EE', '#A78BFA', '#34D399', '#60A5FA', '#FBBF24', '#F472B6'];
  let c = txt(28, 38, 'Code & consistency', 'title') + txt(28, 63, 'Language composition · original public repositories', 'label');
  if (total) {
    let cursor = 28;
    const barWidth = mobile ? 364 : 480;
    entries.forEach(([, bytes], index) => {
      const w = bytes / total * barWidth;
      c += `<rect x="${cursor.toFixed(2)}" y="88" width="${w.toFixed(2)}" height="9" fill="${colors[index % colors.length]}"/>`;
      cursor += w;
    });
    entries.slice(0, 6).forEach(([name, bytes], index) => {
      const x = 28 + index % 2 * (mobile ? 182 : 242);
      const y = 126 + Math.floor(index / 2) * 26;
      c += `<circle cx="${x + 4}" cy="${y - 4}" r="4" fill="${colors[index % colors.length]}"/>` + txt(x + 15, y, `${name} ${(bytes / total * 100).toFixed(1)}%`, 'small');
    });
    c += txt(28, mobile ? 222 : 219, `GitHub language bytes · excludes forks · snapshot ${languageData.observedAt}`, 'muted small');
  } else c += txt(28, 110, 'Language API unavailable · previous data retained when available', 'label');
  const sx = mobile ? 28 : 570;
  const sy = mobile ? 276 : 105;
  if (model.contributions) {
    const streak = calculateStreaks(model.contributions.days, model.contributions.to);
    c += txt(sx, sy, `${streak.current} days`, 'value cyan') + txt(sx, sy + 23, 'Current contribution streak', 'label');
    c += txt(sx, sy + 73, `${streak.longest} days`, 'value purple') + txt(sx, sy + 96, 'Longest streak · calendar year', 'label');
    c += txt(sx, sy + 122, `Through ${model.contributions.to} · UTC calendar dates`, 'muted small');
  }
  return svg(width, height, 'Public repository languages and contribution streaks', 'Language percentages measure GitHub repository source bytes, not proficiency. Current streak includes yesterday when today is still in progress. Both streaks are limited to the displayed calendar year.', c);
}

export function renderAssets(model) {
  return {
    'github-activity.svg': dashboard(model),
    'github-activity-mobile.svg': dashboard(model, true),
    'contribution-graph.svg': graph(model),
    'contribution-graph-mobile.svg': graph(model, true),
    'github-languages.svg': languageCard(model),
    'github-languages-mobile.svg': languageCard(model, true),
  };
}

async function readJSON(filename) {
  try { return JSON.parse(await readFile(filename, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeChanged(filename, content) {
  let old;
  try { old = await readFile(filename, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (old === content) return false;
  const temporary = filename + '.tmp';
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, filename);
  return true;
}

export async function updateProfile({ username = DEFAULT_USER, root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), today = dateKey(new Date()), token, request } = {}) {
  if (!/^[a-zA-Z0-9-]{1,39}$/.test(username)) throw new Error('Invalid GitHub username');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || dateKey(today) !== today) throw new Error('Invalid snapshot date');
  const from = today.slice(0, 4) + '-01-01';
  const assetDir = path.join(root, 'assets');
  const previous = await readJSON(path.join(assetDir, 'profile-data.json'));
  const get = request || ((url, options = {}) => requestGitHub(url, { token, ...options }));
  // Required REST calls finish and validate before any existing output is touched.
  const user = await (await get(`${API}/users/${username}`)).json();
  const repositories = await fetchAllPages(`${API}/users/${username}/repos?type=owner&per_page=100&sort=full_name`, { request: get });
  if (user.login?.toLowerCase() !== username.toLowerCase() || !integer(user.public_repos) || repositories.length !== user.public_repos) throw new Error('Repository count changed or public inventory is incomplete; retry later');
  let languages = null;
  try {
    const bytes = {};
    for (const repo of repositories.filter(repo => !repo.fork && !repo.private)) {
      const result = await (await get(`${API}/repos/${username}/${encodeURIComponent(repo.name)}/languages`)).json();
      if (!result || Array.isArray(result) || Object.values(result).some(value => !integer(value))) throw new Error('Invalid language response');
      for (const [name, value] of Object.entries(result)) bytes[name] = (bytes[name] || 0) + value;
    }
    const sortedBytes = Object.fromEntries(Object.entries(bytes).sort(([a], [b]) => a.localeCompare(b)));
    languages = { bytes: sortedBytes, observedAt: same(sortedBytes, previous?.languages?.bytes) ? previous.languages.observedAt : today };
  } catch { console.warn('Language data unavailable; keeping the last successful language snapshot.'); }
  let contributions = null;
  try {
    const html = await (await get(`https://github.com/users/${username}/contributions?from=${from}&to=${today}`)).text();
    contributions = parseContributionHTML(html, { from, to: today });
  } catch { console.warn('Public contribution calendar unavailable; keeping the last successful calendar snapshot.'); }
  if (token && contributions) {
    try {
      const payload = await (await get(`${API}/graphql`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: graphQuery, variables: { login: username, from: from + 'T00:00:00Z', to: today + 'T23:59:59Z' } }) })).json();
      const authenticated = normalizeGraphQL(payload, { from, to: today });
      // Do not publish any token-only calendar counts. Public calendar remains authoritative.
      if (same(authenticated.days, contributions.days)) contributions.metrics = authenticated.metrics;
      else console.warn('Authenticated and public calendar scope differs; publishing public calendar only.');
    } catch { console.warn('Public GraphQL breakdown unavailable; optional commit, PR, issue and review counts omitted.'); }
  }
  const model = buildModel({ user, repositories, languages, contributions, previous, today });
  // Render everything before writing; a render failure preserves previous assets.
  const outputs = { ...renderAssets(model), 'profile-data.json': JSON.stringify(model, null, 2) + '\n' };
  await mkdir(assetDir, { recursive: true });
  let changed = 0;
  for (const [filename, content] of Object.entries(outputs)) if (await writeChanged(path.join(assetDir, filename), content)) changed++;
  console.log(`Public profile refreshed: ${repositories.length} repositories; ${changed} changed assets.`);
  return { model, changed };
}

export async function main() {
  try {
    await updateProfile({ username: process.env.PROFILE_USERNAME || DEFAULT_USER, token: process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN });
  } catch (error) {
    // All API errors are deliberately sanitized; tokens and response bodies are never logged.
    console.error(`Profile refresh stopped: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
