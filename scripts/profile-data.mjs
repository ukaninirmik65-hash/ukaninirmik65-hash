const API = 'https://api.github.com';
const DAY = 86_400_000;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export const dateKey = date => new Date(date).toISOString().slice(0, 10);
export const integer = value => Number.isSafeInteger(value) && value >= 0;
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && dateKey(value) === value;

class GitHubRequestError extends Error {
  constructor(status, rateLimited) {
    super(`GitHub request failed (HTTP ${status}${rateLimited ? ', rate limited' : ''})`);
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

export async function requestGitHub(url, { token, fetchImpl = fetch, sleep = pause, maxAttempts = 3, ...options } = {}) {
  const target = new URL(url);
  if (![API, 'https://github.com'].includes(target.origin) || target.username || target.password) {
    throw new Error('Untrusted GitHub request origin');
  }
  const headers = new Headers(options.headers);
  headers.delete('authorization');
  headers.set('User-Agent', 'Nirmik-Profile-Refresh');
  headers.set('Accept', target.origin === API ? 'application/vnd.github+json' : 'text/html');
  if (target.origin === API) {
    headers.set('X-GitHub-Api-Version', '2022-11-28');
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
    } catch {
      if (attempt === maxAttempts - 1) throw new Error('GitHub connection failed after bounded retries');
      await sleep(250 * 2 ** attempt);
      continue;
    }
    if (response.ok) return response;
    const retryAfter = response.headers.get('retry-after');
    const exhausted = response.headers.get('x-ratelimit-remaining') === '0';
    const rateLimited = response.status === 429 || (response.status === 403 && (exhausted || retryAfter !== null));
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    const wait = retryAfter === null ? (exhausted ? Math.max(reset, 0) : 0)
      : (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now());
    const error = new GitHubRequestError(response.status, rateLimited);
    if (!(rateLimited || response.status >= 500) || attempt === maxAttempts - 1 || wait > 2000) throw error;
    await sleep(Math.max(Number.isFinite(wait) ? wait : 0, 250 * 2 ** attempt));
  }
  throw new Error('GitHub request failed');
}

export function publicRequest(token, fetchImpl) {
  return async (url, options) => {
    try {
      return await requestGitHub(url, { ...options, token, fetchImpl });
    } catch (error) {
      // A repository-scoped Actions token may lack access to another public repository.
      if (!token || error.rateLimited || ![401, 403, 404].includes(error.status)) throw error;
      return requestGitHub(url, { ...options, fetchImpl });
    }
  };
}

export async function fetchAllPages(url, { request = requestGitHub, maxPages = 100 } = {}) {
  const items = [];
  const pages = new Set();
  const ids = new Set();
  let next = url;
  while (next && pages.size < maxPages) {
    const target = new URL(next);
    if (target.origin !== API || target.username || target.password || pages.has(target.href)) {
      throw new Error('Unsafe or circular API pagination');
    }
    pages.add(target.href);
    const response = await request(target.href);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Expected a paginated API array');
    for (const item of page) {
      if (!item || !['string', 'number'].includes(typeof item.id) || ids.has(item.id)) {
        throw new Error('API pagination returned a missing or duplicate identifier');
      }
      ids.add(item.id);
      items.push(item);
    }
    next = (response.headers.get('link') || '').match(/<([^>]+)>;\s*rel="next"/)?.[1];
  }
  if (next) throw new Error('API pagination exceeded its page limit');
  return items;
}

export function normalizeInventory(account, repositories, username) {
  if (account?.login?.toLowerCase() !== username.toLowerCase() || !integer(account.public_repos) || !integer(account.followers)) {
    throw new Error('Invalid public account response');
  }
  const login = account.login;
  const publicRepos = repositories.filter(repo => repo?.private === false && repo.visibility === 'public');
  if (publicRepos.length !== account.public_repos) throw new Error('Incomplete public repository inventory; retry later');
  const normalized = publicRepos.map(repo => {
    if (repo.owner?.login?.toLowerCase() !== login.toLowerCase() || typeof repo.name !== 'string'
      || !/^[\w.-]{1,100}$/.test(repo.name) || /^\.{1,2}$/.test(repo.name)
      || ![repo.stargazers_count, repo.forks_count].every(integer) || ![repo.fork, repo.archived, repo.disabled].every(value => typeof value === 'boolean')) {
      throw new Error('Invalid public repository response');
    }
    const pushedAt = repo.pushed_at?.slice(0, 10);
    return {
      name: repo.name,
      description: typeof repo.description === 'string' ? repo.description : null,
      url: `https://github.com/${login}/${repo.name}`,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      fork: repo.fork,
      archived: repo.archived,
      disabled: repo.disabled,
      pushedAt: validDate(pushedAt) ? pushedAt : null,
      language: typeof repo.language === 'string' ? repo.language : null,
      homepage: typeof repo.homepage === 'string' ? repo.homepage : null,
      defaultBranch: typeof repo.default_branch === 'string' ? repo.default_branch : null,
      topics: Array.isArray(repo.topics) ? repo.topics.filter(topic => typeof topic === 'string') : [],
    };
  });
  return {
    repositories: normalized,
    stats: {
      repositories: normalized.length,
      stars: normalized.reduce((sum, repo) => sum + repo.stars, 0),
      followers: account.followers,
    },
  };
}

export async function fetchInventory(username, request) {
  const base = `${API}/users/${username}`;
  const [account, repositories] = await Promise.all([
    request(base).then(response => response.json()),
    fetchAllPages(`${base}/repos?type=owner&per_page=100&sort=full_name`, { request }),
  ]);
  return normalizeInventory(account, repositories, username);
}

export function languageDistribution(responses) {
  const bytes = new Map();
  for (const response of responses) {
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Invalid repository language response');
    for (const [name, value] of Object.entries(response)) {
      const total = (bytes.get(name) || 0) + value;
      if (!name.trim() || !integer(value) || !integer(total)) throw new Error('Invalid repository language byte count');
      if (value > 0) bytes.set(name, total);
    }
  }
  const total = [...bytes.values()].reduce((sum, value) => sum + value, 0);
  if (!integer(total)) throw new Error('Invalid total language byte count');
  return [...bytes.entries()].sort(([a, aBytes], [b, bBytes]) => bBytes - aBytes || a.localeCompare(b, 'en'))
    .map(([name, count]) => ({ name, bytes: count, percentage: 100 * (count / total) }));
}

export async function fetchLanguages(username, repositories, request) {
  const eligible = repositories.filter(repo => !repo.fork && !repo.archived && !repo.disabled
    && repo.name.toLowerCase() !== username.toLowerCase());
  const responses = [];
  for (let offset = 0; offset < eligible.length; offset += 6) {
    responses.push(...await Promise.all(eligible.slice(offset, offset + 6).map(async repo => {
      return (await request(`${API}/repos/${username}/${repo.name}/languages`)).json();
    })));
  }
  return languageDistribution(responses);
}

export function validateCalendar(days, { from, to }) {
  if (![from, to].every(validDate)) throw new Error('Invalid contribution date range');
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const expected = (Date.parse(to) - Date.parse(from)) / DAY + 1;
  if (expected < 1 || sorted.length !== expected) throw new Error('Contribution calendar is incomplete');
  for (const [index, day] of sorted.entries()) {
    if (day.date !== dateKey(Date.parse(from) + index * DAY) || !integer(day.count)) {
      throw new Error('Invalid daily contribution count');
    }
  }
  return sorted;
}

/** Public profile tooltips provide exact counts. Color intensity is never used. */
export function parsePublicCalendar(html, period) {
  const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  const counts = new Map();
  for (const match of html.matchAll(/<tool-tip\b([^>]*)>([\s\S]*?)<\/tool-tip>/g)) {
    const count = match[2].replace(/<[^>]*>/g, '').trim().match(/^(No|[\d,]+) contributions? on /);
    const id = attribute(match[1], 'for');
    if (id && count) counts.set(id, count[1] === 'No' ? 0 : Number(count[1].replaceAll(',', '')));
  }
  const days = [];
  for (const match of html.matchAll(/<td\b([^>]*)>/g)) {
    const date = attribute(match[1], 'data-date');
    if (!date || date < period.from || date > period.to) continue;
    days.push({ date, count: counts.get(attribute(match[1], 'id')) });
  }
  return validateCalendar(days, period);
}

export function currentStreak(days, today) {
  const counts = new Map(days.map(day => [day.date, day.count]));
  let cursor = Date.parse(today);
  if (!counts.get(today)) cursor -= DAY;
  let streak = 0;
  while (counts.get(dateKey(cursor)) > 0) {
    streak++;
    cursor -= DAY;
  }
  return streak;
}

const breakdown = {
  commits: ['totalCommitContributions', 'commitContributionsByRepository'],
  pullRequests: ['totalPullRequestContributions', 'pullRequestContributionsByRepository'],
  reviews: ['totalPullRequestReviewContributions', 'pullRequestReviewContributionsByRepository'],
  issues: ['totalIssueContributions', 'issueContributionsByRepository'],
};

export const activityQuery = `query ProfileActivity($login: String!, $from: DateTime!, $to: DateTime!) {
  user(login: $login) {
    login
    contributionsCollection(from: $from, to: $to) {
      restrictedContributionsCount
      contributionCalendar { weeks { contributionDays { date contributionCount } } }
${Object.values(breakdown).map(([total, groups]) => `      ${total}
      ${groups}(maxRepositories: 100) {
        repository { nameWithOwner visibility }
        contributions(first: 1) { totalCount nodes { occurredAt } }
      }`).join('\n')}
    }
  }
}`;

export function normalizeActivity(payload, username, period) {
  const user = payload?.data?.user;
  const collection = user?.contributionsCollection;
  if (payload?.errors?.length || user?.login?.toLowerCase() !== username.toLowerCase() || !collection) {
    throw new Error('Invalid GitHub GraphQL contribution response');
  }
  const counts = {};
  const repositories = new Map();
  let hasNonPublic = false;
  for (const [category, [total, groups]] of Object.entries(breakdown)) {
    const rows = collection[groups];
    if (!Array.isArray(rows) || !integer(collection[total])) throw new Error('Invalid contribution breakdown');
    const seen = new Set();
    let covered = 0;
    let publicCount = 0;
    for (const row of rows) {
      const { nameWithOwner: name, visibility } = row.repository || {};
      const { totalCount: count, nodes } = row.contributions || {};
      if (typeof name !== 'string' || !/^[\w-]{1,39}\/[\w.-]{1,100}$/.test(name) || seen.has(name.toLowerCase())
        || !['PUBLIC', 'PRIVATE', 'INTERNAL'].includes(visibility) || !integer(count)) {
        throw new Error('Invalid contribution repository response');
      }
      seen.add(name.toLowerCase());
      covered += count;
      if (visibility !== 'PUBLIC') {
        hasNonPublic = true;
        continue;
      }
      publicCount += count;
      if (count === 0) continue;
      const time = Date.parse(nodes?.[0]?.occurredAt);
      if (!Number.isFinite(time)) throw new Error('Invalid recent contribution date');
      const date = dateKey(time);
      if (date < period.from || date > period.to || name.toLowerCase() === `${username}/${username}`.toLowerCase()) continue;
      const key = name.toLowerCase();
      if (time > (repositories.get(key)?.time ?? -Infinity)) repositories.set(key, { name, time });
    }
    if (covered !== collection[total]) throw new Error('Incomplete GraphQL contribution breakdown');
    counts[category] = publicCount;
  }
  const days = validateCalendar(collection.contributionCalendar.weeks.flatMap(week => week.contributionDays)
    .filter(day => day.date >= period.from && day.date <= period.to)
    .map(day => ({ date: day.date, count: day.contributionCount })), period);
  if (!integer(collection.restrictedContributionsCount)) throw new Error('Invalid contribution visibility response');
  return {
    ...period,
    counts,
    days,
    canVerifyStreak: !hasNonPublic && collection.restrictedContributionsCount === 0,
    repositories: [...repositories.values()].sort((a, b) => b.time - a.time || a.name.localeCompare(b.name, 'en'))
      .slice(0, 5).map(({ name }) => ({ name, url: `https://github.com/${name}` })),
  };
}

export async function fetchActivity({ username, period, now, tokens, request }) {
  if (!tokens.length) throw new Error('GitHub GraphQL credentials are missing');
  for (const [index, token] of tokens.entries()) {
    try {
      const response = await request(`${API}/graphql`, {
        token, method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: activityQuery, variables: { login: username, from: `${period.from}T00:00:00Z`, to: now } }),
      });
      const activity = normalizeActivity(await response.json(), username, period);
      const url = `https://github.com/users/${username}/contributions?from=${period.from}&to=${period.to}`;
      const publicDays = parsePublicCalendar(await (await request(url)).text(), period);
      const matchesPublic = activity.days.every((day, dayIndex) => day.count === publicDays[dayIndex].count);
      if (activity.canVerifyStreak && !matchesPublic) {
        throw new Error('GraphQL and anonymous contribution dates or counts differ');
      }
      // A user token can see other activity. In that case use only the dates/counts
      // that the account already exposes in its signed-out public profile.
      const streak = currentStreak(matchesPublic ? activity.days : publicDays, period.to);
      return { ...period, counts: activity.counts, streak, repositories: activity.repositories };
    } catch (error) {
      if (index === tokens.length - 1) throw error;
    }
  }
}
