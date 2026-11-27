const API = 'https://api.github.com';
const GITHUB = 'https://github.com';
const PROFILE_OWNER = 'ukaninirmik65-hash';
const ACTIVITY_LIMIT = 5;
const RECENT_DAYS = 90;
const DAY = 86_400_000;

// Project descriptions and dependencies were verified against the sources in
// docs/PROJECT-VERIFICATION.md. API metadata supplies the current repository facts.
const curatedProjects = [
  {
    name: 'ERP-App', title: 'ERP Management Frontend',
    description: 'React frontend prototype for customer records, product listings, inventory and reporting, using local and static data.',
    stack: ['React.js', 'JavaScript', 'CSS3', 'Material UI', 'React Router', 'Recharts', 'Vite'],
    features: ['Customer creation, editing and deletion', 'Search and status filters', 'Inventory views and chart-based reporting'],
    demoUrl: 'https://erp-app-khaki.vercel.app/',
  },
  {
    name: 'atakKriya-2.O', title: 'Atal Kriya 2.0',
    description: 'Employee self-service frontend prototype with simulated login and browser-local data.',
    stack: ['React.js', 'JavaScript', 'Tailwind CSS', 'React Router', 'Leaflet', 'Vite'],
    features: ['Attendance check-in and check-out', 'Leave request validation', 'Expense records and field route maps'],
    demoUrl: 'https://atak-kriya-2-o.vercel.app/',
  },
  {
    name: 'Tetris-Game', title: 'Tetris Game',
    description: 'Browser-based falling-block game built with the Canvas API.',
    stack: ['HTML5', 'CSS3', 'JavaScript', 'Canvas API'],
    features: ['Keyboard movement and rotation', 'Collision detection and line clearing', 'Next-piece preview, audio and local high scores'],
    demoUrl: 'https://ukaninirmik65-hash.github.io/Tetris-Game/',
  },
  {
    name: 'Anitajewellerys', title: 'Anita Jewellery',
    description: 'Responsive jewellery storefront interface showcase.',
    stack: ['HTML5', 'CSS3', 'JavaScript'],
    features: ['Promotional hero', 'Collection and product layouts', 'Mobile navigation'],
    demoUrl: 'https://anitajewellerys-k56t.vercel.app/',
  },
  {
    name: 'Neelmadhav-Public-School', title: 'Neelmadhav Public School',
    description: 'Responsive school information site with academic and event sections.',
    stack: ['HTML5', 'CSS3', 'JavaScript'],
    features: ['Mobile menu and active-section navigation', 'Gallery and event toggles', 'Scroll effects with reduced-motion support'],
    demoUrl: 'https://neelmadhav-public-school.vercel.app/',
  },
  {
    name: 'nirmik-portfolio', title: 'Personal Portfolio',
    description: 'React portfolio presenting projects, frontend services and an inquiry flow.',
    stack: ['React.js', 'JavaScript', 'Tailwind CSS', 'Vite'],
    features: ['Light and dark themes', 'Project filtering', 'Validated inquiry form'],
    demoUrl: 'https://nirmik-portfolio.vercel.app/',
  },
];

const manifestTechnologies = {
  react: 'React.js', next: 'Next.js', 'react-router': 'React Router', 'react-router-dom': 'React Router',
  vue: 'Vue.js', nuxt: 'Nuxt', svelte: 'Svelte', '@sveltejs/kit': 'SvelteKit', '@angular/core': 'Angular',
  astro: 'Astro', '@mui/material': 'Material UI', tailwindcss: 'Tailwind CSS', bootstrap: 'Bootstrap',
  leaflet: 'Leaflet', recharts: 'Recharts', express: 'Express', vite: 'Vite', typescript: 'TypeScript',
};

const lower = value => typeof value === 'string' ? value.toLowerCase() : '';
const repoName = value => typeof value === 'string' && /^[\w.-]{1,100}$/.test(value) && !/^\.{1,2}$/.test(value);
const ownerName = value => typeof value === 'string' && /^[\w-]{1,39}$/.test(value);
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const sha = value => typeof value === 'string' && /^(?!0{40}$)[a-f\d]{40}$/i.test(value);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const bot = account => account?.type === 'Bot' || /\[bot\]$/i.test(account?.login || '');
const titleLine = value => typeof value === 'string' ? value.split(/\r?\n/, 1)[0].trim() : '';
const automationTitle = value => /^(?:chore(?:\([^)]*\))?:\s*)?(?:refresh|update) (?:public )?(?:github )?profile (?:readme|activity|data|assets|stats|statistics)\b/i.test(value);
const activeProject = (repo, username) => repoName(repo.name) && !repo.private && !repo.fork && !repo.archived && !repo.disabled && lower(repo.name) !== lower(username);
const pushedTime = repo => timestamp(repo.pushedAtInstant) || timestamp(repo.pushedAt) || '';
const newestPushFirst = (left, right) => pushedTime(right).localeCompare(pushedTime(left)) || left.name.localeCompare(right.name, 'en');

function missingResource(error) {
  return [404, 409, 410].includes(error?.status) || /\bHTTP (?:404|409|410)\b/.test(error?.message || '');
}

async function listCommits(request, owner, name, query) {
  try {
    const commits = await (await request(`${API}/repos/${owner}/${name}/commits?${new URLSearchParams(query)}`)).json();
    if (!Array.isArray(commits) || commits.some(item => !sha(item?.sha) || !timestamp(item.commit?.committer?.date) || typeof item.commit.message !== 'string')) {
      throw new Error('Invalid repository commit response');
    }
    return commits;
  } catch (error) {
    if (!missingResource(error)) throw error;
    return [];
  }
}

async function readManifestStack(request, owner, name) {
  let file;
  try {
    file = await (await request(`${API}/repos/${owner}/${name}/contents/package.json`)).json();
  } catch (error) {
    if (!missingResource(error)) throw error;
    return [];
  }
  if (file?.type !== 'file' || file.encoding !== 'base64' || typeof file.content !== 'string' || file.content.length > 100_000) return [];
  let manifest;
  try {
    manifest = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    return [];
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return [];
  const packages = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  return [...new Set(Object.entries(manifestTechnologies)
    .filter(([dependency]) => Object.hasOwn(packages, dependency) && typeof packages[dependency] === 'string' && packages[dependency].trim())
    .map(([, technology]) => technology))];
}

function safeDemoUrl(value, username) {
  if (!value || typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const platform = /^[\w-]+\.(?:vercel\.app|netlify\.app|pages\.dev)$/.test(url.hostname);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        (platform || url.hostname === `${lower(username)}.github.io`) && !url.search && !url.hash) return url;
  } catch { /* Invalid or unsupported homepage. */ }
  return null;
}

// Site probes are unauthenticated and cannot follow arbitrary redirects from API-provided URLs.
async function probeDemo(candidate, username, fetchImpl) {
  let url = candidate;
  for (let redirects = 0; redirects < 4; redirects++) {
    let response;
    try {
      response = await fetchImpl(url.href, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
    } catch {
      return 'temporary';
    }
    await response.body?.cancel().catch(() => {});
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      try {
        const location = response.headers.get('location');
        url = location && safeDemoUrl(new URL(location, url).href, username);
      } catch {
        return 'unavailable';
      }
      if (!url) return 'unavailable';
      continue;
    }
    if (response.status === 429 || response.status >= 500) return 'temporary';
    return response.ok && /^(?:text\/html|application\/xhtml\+xml)\b/i.test(response.headers.get('content-type') || '') ? 'verified' : 'unavailable';
  }
  return 'unavailable';
}

async function verifiedDemo({ urls, username, fetchImpl, previous, onWarning }) {
  const candidates = [...new Set(urls.map(value => safeDemoUrl(value, username)?.href).filter(Boolean))];
  let stale = null;
  for (const href of candidates) {
    const result = await probeDemo(new URL(href), username, fetchImpl);
    if (result === 'verified') return href;
    if (result === 'temporary') {
      onWarning('A deployment could not be rechecked. Preserving its last verified link when available.');
      if (href === previous) stale = href;
    }
  }
  return stale;
}

export async function fetchProjects({ username, repositories, request, fetchImpl = fetch, previousProjects = [], onWarning = console.warn }) {
  const active = repositories.filter(repo => activeProject(repo, username));
  const curated = lower(username) === PROFILE_OWNER ? curatedProjects : [];
  const selected = curated.flatMap(details => {
    const repo = active.find(item => lower(item.name) === lower(details.name));
    return repo ? [{ repo, details }] : [];
  });
  const excluded = new Set([...curated.map(item => lower(item.name)), 'demo', 'motiwalaperfumes-clone']);
  const discovered = active.filter(repo => !excluded.has(lower(repo.name)) && repo.description?.trim() &&
    (repo.topics?.includes('featured') || (repo.stars > 0 && repo.language)))
    .sort((left, right) => right.stars - left.stars || newestPushFirst(left, right))
    .slice(0, Math.max(0, 8 - selected.length));
  selected.push(...discovered.map(repo => ({ repo })));

  return Promise.all(selected.map(async ({ repo, details }) => {
    const [commits, demoUrl, stack] = await Promise.all([
      listCommits(request, username, repo.name, { per_page: 5 }),
      verifiedDemo({
        urls: [details?.demoUrl, repo.homepage], username, fetchImpl, onWarning,
        previous: previousProjects.find(item => lower(item.name) === lower(repo.name))?.demoUrl,
      }),
      details?.stack ?? readManifestStack(request, username, repo.name),
    ]);
    const meaningful = commits.find(item => {
      const title = titleLine(item.commit.message);
      return title && !bot(item.author) && !bot(item.committer) && !automationTitle(title);
    });
    const githubDescription = repo.description?.trim() || null;
    const description = details?.description || githubDescription;
    return {
      name: repo.name,
      title: details?.title || repo.name,
      description,
      githubDescription: githubDescription !== description ? githubDescription : null,
      language: repo.language,
      stack,
      features: details?.features || [],
      stars: repo.stars,
      forks: repo.forks,
      license: repo.license || null,
      pushedAt: pushedTime(repo).slice(0, 10) || null,
      updatedAt: timestamp(meaningful?.commit.committer.date)?.slice(0, 10) || null,
      url: `${GITHUB}/${username}/${repo.name}`,
      demoUrl,
    };
  }));
}

export function getRecentlyUpdatedProjects({ username, repositories }) {
  return repositories.filter(repo => activeProject(repo, username) && pushedTime(repo))
    .sort(newestPushFirst).slice(0, ACTIVITY_LIMIT)
    .map(repo => ({ name: repo.name, url: `${GITHUB}/${username}/${repo.name}`, updatedAt: pushedTime(repo).slice(0, 10) }));
}

function publicEventRepo(event, username) {
  if (event?.public !== true || lower(event.actor?.login) !== lower(username) || bot(event.actor) || typeof event.repo?.name !== 'string') return null;
  const [owner, name, extra] = event.repo.name.split('/');
  return extra === undefined && ownerName(owner) && repoName(name) && lower(owner + '/' + name) !== lower(username + '/' + username) ? `${owner}/${name}` : null;
}

function eventActivity({ event, repo, time }) {
  const { action, issue, pull_request: pull, release } = event.payload || {};
  if (event.type === 'PullRequestEvent' && (action === 'opened' || (action === 'closed' && pull?.merged === true)) && positiveInteger(pull?.number) && titleLine(pull.title)) {
    return { kind: 'Pull request', title: titleLine(pull.title), repo, time, url: `${GITHUB}/${repo}/pull/${pull.number}` };
  }
  if (event.type === 'IssuesEvent' && ['opened', 'closed'].includes(action) && positiveInteger(issue?.number) && titleLine(issue.title)) {
    return { kind: 'Issue', title: titleLine(issue.title), repo, time, url: `${GITHUB}/${repo}/issues/${issue.number}` };
  }
  if (event.type === 'ReleaseEvent' && action === 'published' && release?.draft === false && titleLine(release.tag_name)) {
    return { kind: 'Release', title: titleLine(release.name) || titleLine(release.tag_name), repo, time, url: `${GITHUB}/${repo}/releases/tag/${encodeURIComponent(release.tag_name)}` };
  }
  return null;
}

function commitActivity(commit, repo, username) {
  if (!sha(commit?.sha) || lower(commit.author?.login) !== lower(username) || bot(commit.author) || bot(commit.committer)) return null;
  const title = titleLine(commit.commit?.message);
  const time = timestamp(commit.commit?.author?.date);
  if (!time || !title || automationTitle(title)) return null;
  return { kind: 'Commit', title, repo, time, url: `${GITHUB}/${repo}/commit/${commit.sha}` };
}

function recentEntries(entries, since, until) {
  const ordered = entries.filter(item => item && item.time >= since && item.time <= until)
    .sort((a, b) => b.time.localeCompare(a.time) || a.url.localeCompare(b.url));
  const seen = new Set();
  return ordered.filter(item => {
    const key = item.url.replace(`${GITHUB}/${item.repo}/`, `${GITHUB}/${lower(item.repo)}/`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, ACTIVITY_LIMIT).map(({ time, ...item }) => ({ ...item, date: time.slice(0, 10) }));
}

async function pushCommit(request, username, { event, repo, time }) {
  try {
    const commit = await (await request(`${API}/repos/${repo}/commits/${event.payload.head}`)).json();
    if (lower(commit?.sha) !== lower(event.payload.head) || typeof commit.commit?.message !== 'string' || !timestamp(commit.commit?.author?.date)) {
      throw new Error('Invalid pushed commit response');
    }
    const result = commitActivity(commit, repo, username);
    return result && { ...result, time };
  } catch (error) {
    if (!missingResource(error)) throw error;
    return null;
  }
}

async function verifyPublicRepository(request, repo) {
  try {
    const current = await (await request(`${API}/repos/${repo}`)).json();
    if (!current || typeof current.private !== 'boolean' || !['public', 'private', 'internal'].includes(current.visibility)) {
      throw new Error('Invalid event repository response');
    }
    return current.private === false && current.visibility === 'public';
  } catch (error) {
    if (!missingResource(error)) throw error;
    return false;
  }
}

export async function fetchRecentActivity({ username, repositories, request, fetchAllPages, now = new Date() }) {
  const until = new Date(now).toISOString();
  const since = new Date(Date.parse(until) - RECENT_DAYS * DAY).toISOString();
  const events = await fetchAllPages(`${API}/users/${username}/events/public?per_page=100`, { request, maxPages: 3 });
  const ordered = events.flatMap(event => {
    const repo = publicEventRepo(event, username);
    const time = timestamp(event?.created_at);
    return repo && time && time >= since && time <= until ? [{ event, repo, time }] : [];
  }).sort((a, b) => b.time.localeCompare(a.time));
  const items = [];
  const resolved = new Set();
  const owned = new Set(repositories.filter(repo => !repo.private).map(repo => lower(`${username}/${repo.name}`)));
  const external = new Map();
  for (const entry of ordered) {
    const candidate = eventActivity(entry);
    const { type, payload } = entry.event;
    const push = type === 'PushEvent' && typeof payload?.ref === 'string' && payload.ref.startsWith('refs/heads/') && sha(payload.head);
    if (!candidate && (!push || resolved.size >= 15)) continue;

    // An event can predate a repository visibility change. Confirm current public access.
    const repoKey = lower(entry.repo);
    if (repoKey.startsWith(`${lower(username)}/`)) {
      if (!owned.has(repoKey)) continue;
    } else {
      if (!external.has(repoKey) && external.size < 12) external.set(repoKey, await verifyPublicRepository(request, entry.repo));
      if (!external.get(repoKey)) continue;
    }

    if (candidate) items.push(candidate);
    if (push) {
      const key = `${repoKey}/${lower(payload.head)}`;
      if (!resolved.has(key)) {
        resolved.add(key);
        items.push(await pushCommit(request, username, entry));
      }
    }
    if (recentEntries(items, since, until).length === ACTIVITY_LIMIT) break;
  }

  if (recentEntries(items, since, until).length < ACTIVITY_LIMIT) {
    const projects = repositories.filter(repo => activeProject(repo, username) && pushedTime(repo).slice(0, 10) >= since.slice(0, 10))
      .sort(newestPushFirst).slice(0, 8);
    const fallback = await Promise.all(projects.map(async project => {
      const commits = await listCommits(request, username, project.name, { author: username, since, per_page: 5 });
      return commits.map(commit => commitActivity(commit, `${username}/${project.name}`, username));
    }));
    items.push(...fallback.flat());
  }
  return recentEntries(items, since, until);
}
