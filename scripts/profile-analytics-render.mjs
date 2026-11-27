const WIDTH = 366;
const number = new Intl.NumberFormat('en-US');
const scrub = value => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffe\uffff\uD800-\uDFFF]/gu, ' ')
  .replace(/\s+/gu, ' ').trim();
const xml = value => scrub(value).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
const markdown = value => scrub(value).replace(/[\\`*_[\]{}()#!|~:+<>&@]/g, character => `&#${character.charCodeAt(0)};`);
const available = value => Number.isSafeInteger(value) && value >= 0;
const count = value => available(value) ? number.format(value) : 'Unavailable';
const duration = value => available(value) ? `${count(value)} ${value === 1 ? 'day' : 'days'}` : 'Unavailable';
const timestamp = value => `${value.length === 10 ? value : `${value.slice(0, 10)} ${value.slice(11, 16)}`} UTC`;
const period = data => data?.from && data?.to ? `${data.from} to ${data.to} UTC` : 'Current year · UTC';
const shorten = value => {
  const clean = scrub(value);
  return clean.length > 28 ? `${clean.slice(0, 27)}…` : clean;
};

function cached(section) {
  return section?.stale && section.observedAt ? `_Cached data from ${timestamp(section.observedAt)}._` : '';
}

function repositoryLabel(repository) {
  if (!repository?.name) return 'Unavailable';
  const label = markdown(repository.name);
  const url = /^https:\/\/github\.com\/[\w-]+\/[\w.-]+$/u.test(repository.url) ? repository.url : null;
  return url ? `[${label}](<${url}>)` : label;
}

function statTiles(account, activity) {
  return [
    ['Public repos', count(account?.repositories)],
    ['Original repos', count(account?.originals)],
    ['Stars received', count(account?.stars)],
    ['Forks received', count(account?.forks)],
    ['Followers', count(account?.followers)],
    ['Following', count(account?.following)],
    ['Contributions', count(activity?.totalContributions)],
    ['Pull requests', count(activity?.counts?.pullRequests)],
    ['Issues', count(activity?.counts?.issues)],
    ['Current streak', duration(activity?.streak)],
    ['Longest streak', duration(activity?.longestStreak)],
    ['Active days', count(activity?.activeDays)],
  ];
}

function text(x, y, value, style, anchor = 'start') {
  return `  <text class="${style}" x="${x}" y="${y}" text-anchor="${anchor}">${xml(value)}</text>`;
}

function rect(x, y, width, height, style, radius = 0, title = '') {
  const element = `  <rect class="${style}" x="${x}" y="${y}" width="${width}" height="${height}" rx="${radius}"`;
  return title ? `${element}><title>${xml(title)}</title></rect>` : `${element} />`;
}

function svg(height, title, description, lines) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${xml(title)}</title>
  <desc id="description">${xml(description)}</desc>
  <style>
    :root { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .surface { fill: #f7f9ff; stroke: #bac7de; }
    .tile { fill: #eef3fd; }
    .heading { fill: #172b4a; font-size: 19px; font-weight: 700; }
    .label { fill: #253c5c; font-size: 13px; font-weight: 650; }
    .muted { fill: #425971; font-size: 12px; }
    .small { fill: #425971; font-size: 10px; }
    .value { fill: #182d4d; font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .axis { stroke: #b0bfd5; stroke-width: 1; }
    @media (prefers-color-scheme: dark) {
      .surface { fill: #111a2c; stroke: #384a67; }
      .tile { fill: #1c2940; }
      .heading, .value { fill: #edf3ff; }
      .label { fill: #dce7fb; }
      .muted, .small { fill: #acbed8; }
      .axis { stroke: #526684; }
    }
  </style>
${rect(0.5, 0.5, WIDTH - 1, height - 1, 'surface', 14)}
${lines.join('\n')}
</svg>
`;
}

export function renderDashboard(model) {
  const account = model.stats?.data;
  const activity = model.activity?.data;
  const language = model.languages?.data?.[0]?.name;
  const repository = account?.latestRepository;
  const tiles = statTiles(account, activity);
  const freshestRepository = repository?.name ? `${repository.name}${repository.date ? ` · ${repository.date}` : ''}` : 'Unavailable';
  const description = [
    period(activity), ...tiles.map(([label, value]) => `${label}: ${value}`),
    `Latest repository push: ${freshestRepository}`, `Top language by bytes: ${language || 'Unavailable'}`,
    model.lastSuccessfulAt && `Last complete refresh: ${timestamp(model.lastSuccessfulAt)}`,
  ].filter(Boolean).join('. ');
  const lines = [
    text(16, 30, 'GitHub statistics', 'heading'),
    text(16, 51, 'Public account totals', 'muted'),
    text(16, 192, 'Year-to-date profile activity', 'label'),
    text(16, 210, period(activity), 'small'),
  ];
  for (const [index, [label, value]] of tiles.entries()) {
    const row = Math.floor(index / 3);
    const x = 15 + (index % 3) * 114;
    const y = 63 + row * 55 + (row >= 2 ? 49 : 0);
    lines.push(rect(x, y, 108, 49, 'tile', 8),
      text(x + 8, y + 18, label, 'small'), text(x + 8, y + 39, value, 'value'));
  }
  lines.push(
    text(16, 345, 'Latest repository push', 'small'),
    ...(repository?.date ? [text(349, 345, `${repository.date} UTC`, 'small', 'end')] : []),
    text(16, 364, shorten(repository?.name || 'Unavailable'), 'label'),
    text(16, 387, 'Top language by repository bytes', 'small'),
    text(16, 405, shorten(language || 'Unavailable'), 'label'),
    text(16, 433, model.lastSuccessfulAt ? `Last complete refresh · ${timestamp(model.lastSuccessfulAt)}` : 'Complete refresh unavailable', 'small'),
  );
  return svg(448, 'GitHub statistics dashboard', description, lines);
}

export function dashboardMarkdown(stats, activity, languages) {
  const account = stats?.data;
  const overview = activity?.data;
  const commits = overview?.counts?.commits;
  const pulls = overview?.counts?.pullRequests;
  const language = languages?.data?.[0]?.name;
  const repository = account?.latestRepository;
  return [
    '<img src="assets/github-statistics.svg" width="366" alt="GitHub statistics showing account totals, year-to-date activity, latest repository push and top language. The figures are available below as text." />',
    ...[['Public totals', stats], ['Contribution metrics', activity], ['Language distribution', languages]]
      .map(([label, section]) => cached(section) ? `${label} · ${cached(section)}` : '').filter(Boolean),
    '<details>\n<summary>Statistics as text</summary>',
    '**Public account totals**',
    [
      '| Repos | Stars | Followers |',
      '| ---: | ---: | ---: |',
      `| ${count(account?.repositories)} | ${count(account?.stars)} | ${count(account?.followers)} |`,
    ].join('\n'),
    `Original repositories: **${count(account?.originals)}** · Forks received: **${count(account?.forks)}** · Following: **${count(account?.following)}**`,
    `**Year-to-date profile activity** · ${markdown(period(overview))}`,
    [
      '| Commits | PRs | Profile streak |',
      '| ---: | ---: | ---: |',
      `| ${count(commits)} | ${count(pulls)} | ${duration(overview?.streak)} |`,
    ].join('\n'),
    `Contributions: **${count(overview?.totalContributions)}** · Issues: **${count(overview?.counts?.issues)}**`,
    `Longest streak: **${duration(overview?.longestStreak)}** · Active days: **${count(overview?.activeDays)}**`,
    `Latest repository push: ${repositoryLabel(repository)}${repository?.date ? ` · ${markdown(repository.date)} UTC` : ''}`,
    `Top language by repository bytes: **${language ? markdown(language) : 'Unavailable'}**`,
    overview?.previousYear && `Same period last year: **${count(overview.previousYear.totalContributions)}** contributions (${markdown(period(overview.previousYear))}).`,
    overview?.previousYearStale && overview.previousYearObservedAt && `_Prior-year data cached ${timestamp(overview.previousYearObservedAt)}._`,
    '</details>',
  ].filter(Boolean).join('\n\n');
}
