import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const USER = 'ukaninirmik65-hash';
export class API {
  constructor(token, fetcher = fetch, sleep = ms => new Promise(r => setTimeout(r, ms))) {
    this.token = token; this.fetcher = fetcher; this.sleep = sleep;
  }
  async request(path, body) {
    for (let attempt = 0; attempt < 6; attempt++) {
      let response;
      try {
        response = await this.fetcher(`https://api.github.com${path}`, {
          method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(60000),
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch {
        if (attempt === 5) throw new Error('GitHub network request failed');
        await this.sleep(1000 * 2 ** attempt); continue;
      }
      const data = await response.json();
      const limited = response.status === 429 || (response.status === 403 &&
        (response.headers.get('x-ratelimit-remaining') === '0' || /rate limit|abuse/i.test(data.message || '')));
      if (limited || response.status >= 500) {
        if (attempt === 5) throw new Error('GitHub retry budget exhausted; keeping previous statistics');
        const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000;
        const seconds = Number(response.headers.get('retry-after'));
        const delay = Math.max(1000 * 2 ** attempt, seconds * 1000 || 0,
          limited && reset ? reset - Date.now() + 1000 : 0, limited ? 60000 : 0);
        if (delay > 900000) throw new Error('Rate limit reset exceeds wait budget');
        await this.sleep(delay); continue;
      }
      if (!response.ok) {
        const error = new Error(`GitHub API HTTP ${response.status}`);
        error.status = response.status; error.apiMessage = data.message; throw error;
      }
      if (data.errors) throw new Error('GraphQL returned errors; keeping previous statistics');
      return data;
    }
  }
  async pages(path) {
    const result = [];
    for (let page = 1; ; page++) {
      const data = await this.request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(data)) throw new Error('Expected a paginated array');
      result.push(...data);
      if (data.length < 100) return result;
    }
  }
  async graphql(query, variables) {
    return (await this.request('/graphql', { query, variables })).data;
  }
}

export async function countCommits(api, repo, userId, username, unique) {
  const base = `/repos/${repo.full_name}`;
  let branches;
  try { branches = await api.pages(`${base}/branches`); }
  catch (e) {
    if (e.status === 409 && /empty/i.test(e.apiMessage || '')) return;
    throw e;
  }
  // Pin branch heads to SHAs so a moving branch cannot shift pagination mid-scan.
  for (const head of new Set(branches.map(b => b.commit.sha))) {
    const commits = await api.pages(`${base}/commits?author=${encodeURIComponent(username)}&sha=${head}`);
    for (const commit of commits) {
      if (commit.author?.id === userId) unique.add(commit.sha);
    }
  }
}

export async function collect(api, now = new Date()) {
  const me = await api.request('/user');
  if (me.login.toLowerCase() !== USER) throw new Error('STATS_TOKEN must belong to the profile owner');
  // Classic repo scope provides all private repository visibility, rather than selected-repository visibility.
  if (!Number.isInteger(me.owned_private_repos)) throw new Error('Private repository count unavailable; use a classic PAT with repo scope');
  const repos = [...new Map((await api.pages('/user/repos?affiliation=owner&visibility=all&sort=full_name&direction=asc'))
    .filter(r => r.owner.id === me.id).map(r => [r.id, r])).values()];
  const privateCount = repos.filter(r => r.private).length;
  if (privateCount !== me.owned_private_repos || repos.length - privateCount !== me.public_repos)
    throw new Error('Repository coverage mismatch; no partial statistics published');
  const commits = new Set(), languages = {};
  for (const repo of repos) {
    await countCommits(api, repo, me.id, me.login, commits);
    for (const [name, bytes] of Object.entries(await api.request(`/repos/${repo.full_name}/languages`)))
      languages[name] = (languages[name] || 0) + bytes;
  }
  const { user } = await api.graphql(`query($login:String!){user(login:$login){
    pullRequests{totalCount} issues{totalCount}
  }}`, { login: me.login });
  if (!user) throw new Error('Profile unavailable');
  let contributions = 0, reviews = 0;
  for (let year = new Date(me.created_at).getUTCFullYear(); year <= now.getUTCFullYear(); year++) {
    const from = `${year}-01-01T00:00:00Z`;
    const to = year === now.getUTCFullYear() ? now.toISOString() : `${year}-12-31T23:59:59Z`;
    const data = await api.graphql(`query($login:String!,$from:DateTime!,$to:DateTime!){
      user(login:$login){contributionsCollection(from:$from,to:$to){
        contributionCalendar{totalContributions} totalPullRequestReviewContributions
      }}
    }`, { login: me.login, from, to });
    const c = data.user?.contributionsCollection;
    if (!c) throw new Error('Contributions unavailable');
    contributions += c.contributionCalendar.totalContributions;
    reviews += c.totalPullRequestReviewContributions;
  }
  return { updated: now.toISOString(), repositories: repos.length, public: repos.length - privateCount,
    private: privateCount, stars: repos.reduce((n,r) => n + r.stargazers_count, 0),
    forks: repos.reduce((n,r) => n + r.forks_count, 0), followers: me.followers, following: me.following,
    commits: commits.size, contributions, pullRequests: user.pullRequests.totalCount,
    issues: user.issues.totalCount, reviews, languages };
}

export function render(s) {
  const rows = [['Total Repositories',s.repositories],['Public Repositories',s.public],['Private Repositories',s.private],
    ['Total Stars',s.stars],['Total Forks',s.forks],['Total Followers',s.followers],['Total Following',s.following],
    ['**All-Time Commits**',s.commits],['Total Contributions (account lifetime)',s.contributions],
    ['Total Pull Requests (authored)',s.pullRequests],['Total Issues (authored)',s.issues],
    ['Total Code Reviews (GitHub contribution count, account lifetime)',s.reviews]];
  const totalBytes = Object.values(s.languages).reduce((a,b) => a+b,0);
  const langs = Object.entries(s.languages).sort((a,b) => b[1]-a[1]);
  return `Last successful update: **${s.updated}** (UTC). Updated daily by GitHub Actions.\n\n` +
    '| Statistic | Total |\n| :-- | --: |\n' + rows.map(([k,v]) => `| ${k} | ${v.toLocaleString('en-US')} |`).join('\n') +
    '\n\n### Most Used Programming Languages\n\n' +
    (totalBytes ? '| Language | Share of code bytes |\n| :-- | --: |\n' + langs.map(([k,v]) =>
      `| ${k.replaceAll('|','\\|')} | ${(v / totalBytes * 100).toFixed(2)}% |`).join('\n') : 'No language data reported by GitHub.') +
    '\n\nAll-Time Commits counts unique commit SHAs authored by my linked GitHub account across every current branch of every owned public and private repository, including forks and archived repositories. No date cutoff. Shared SHAs are counted once across repositories. Deleted repositories, deleted branch-only history, unlinked author emails, and repositories no longer owned cannot be recovered by this scan.\n\nContributions are GitHub contribution-calendar events summed by calendar year since account creation; they follow GitHub eligibility and private-contribution visibility rules and are different from commits. Code reviews use GitHub’s review-contribution count, not every review submission. PRs and issues are authored totals across repositories visible to the token. Repository, star, fork, and language totals cover owned repositories; language share measures code bytes, not proficiency. Private repository names and code are never published.\n';
}

export function replaceStats(readme, block) {
  const start = '<!-- LIVE-STATS:START -->', end = '<!-- LIVE-STATS:END -->';
  if (readme.split(start).length !== 2 || readme.split(end).length !== 2 || readme.indexOf(end) < readme.indexOf(start))
    throw new Error('Expected exactly one ordered statistics marker pair');
  return readme.slice(0, readme.indexOf(start) + start.length) + '\n\n' + block + '\n' + readme.slice(readme.indexOf(end));
}

async function main() {
  if (!process.env.STATS_TOKEN) throw new Error('Add repository Actions secret STATS_TOKEN (owner classic PAT: repo, read:user)');
  const readme = await readFile('README.md', 'utf8');
  const stats = await collect(new API(process.env.STATS_TOKEN));
  const result = replaceStats(readme, render(stats));
  // Nothing is written until the entire scan succeeds. Only aggregate data is persisted.
  await writeFile('README.md', result);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
