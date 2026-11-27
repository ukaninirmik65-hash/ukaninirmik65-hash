const DAY = 86_400_000;
const WIDTH = 366;
const number = new Intl.NumberFormat('en-US');
const shortMonth = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const scrub = value => String(value ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffe\uffff\uD800-\uDFFF]/gu, ' ')
  .replace(/\s+/gu, ' ').trim();
const xml = value => scrub(value).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
const markdown = value => scrub(value).replace(/[\\`*_[\]{}()#!|~:+<>&@]/g, character => `&#${character.charCodeAt(0)};`);
const available = value => Number.isSafeInteger(value) && value >= 0;
const count = value => available(value) ? number.format(value) : 'Unavailable';
const duration = value => available(value) ? `${count(value)} ${value === 1 ? 'day' : 'days'}` : 'Unavailable';
const dateKey = date => new Date(date).toISOString().slice(0, 10);
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
    .track, .level-0 { fill: #dfe7f5; }
    .teal, .level-3 { fill: #1b788f; }
    .purple, .level-4 { fill: #6046a6; }
    .level-1 { fill: #9ad6dd; }
    .level-2 { fill: #51abbc; }
    @media (prefers-color-scheme: dark) {
      .surface { fill: #111a2c; stroke: #384a67; }
      .tile { fill: #1c2940; }
      .heading, .value { fill: #edf3ff; }
      .label { fill: #dce7fb; }
      .muted, .small { fill: #acbed8; }
      .axis { stroke: #526684; }
      .track, .level-0 { fill: #263854; }
      .teal, .level-3 { fill: #60c3d3; }
      .purple, .level-4 { fill: #ad9bf5; }
      .level-1 { fill: #385d75; }
      .level-2 { fill: #428a9e; }
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
    '</details>',
  ].join('\n\n');
}

function monday(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.valueOf() - (parsed.getUTCDay() + 6) % 7 * DAY;
}

export function bucketContributionDays(days) {
  const months = new Map();
  const weeks = new Map();
  for (const { date, count: value } of days) {
    const month = date.slice(0, 7);
    const week = dateKey(monday(date));
    months.set(month, (months.get(month) ?? 0) + value);
    weeks.set(week, (weeks.get(week) ?? 0) + value);
  }
  return { months: [...months.entries()].sort(), weeks: [...weeks.entries()].sort() };
}

function heatLevel(count) {
  if (count === 0) return 0;
  if (count < 3) return 1;
  if (count < 6) return 2;
  return count < 10 ? 3 : 4;
}

function heatmap(days) {
  const start = monday(days[0].date);
  const output = [text(16, 80, 'Daily contributions', 'label')];
  let seenMonth = '';
  for (const { date, count: value } of days) {
    const offset = (Date.parse(`${date}T00:00:00Z`) - start) / DAY;
    const x = 17 + Math.floor(offset / 7) * 6.2;
    const y = 110 + offset % 7 * 6.4;
    const month = date.slice(5, 7);
    if (month !== seenMonth && ['01', '04', '07', '10'].includes(month)) {
      output.push(text(x.toFixed(1), 104, shortMonth.format(Date.parse(date)), 'small'));
      seenMonth = month;
    }
    output.push(rect(x.toFixed(1), y.toFixed(1), 5.1, 5.1, `level-${heatLevel(value)}`, 1, `${date} UTC · ${count(value)}`));
  }
  for (const [index, label] of ['0', '1–2', '3–5', '6–9', '10+'].entries()) {
    const x = 19 + index * 47;
    output.push(rect(x, 163, 9, 9, `level-${index}`, 2), text(x + 13, 172, label, 'small'));
  }
  return output;
}

function periodBars(entries, label, y, slots, monthLabels = false) {
  const max = Math.max(0, ...entries.map(([, value]) => value));
  const left = 17;
  const slot = 332 / slots;
  const baseline = y + 66;
  const lines = [
    text(16, y, label, 'label'),
    text(349, y, `Peak ${count(max)}`, 'small', 'end'),
    `  <path class="axis" d="M 17,${baseline + 0.5} H 349" />`,
  ];
  for (const [index, [key, value]] of entries.entries()) {
    const x = left + index * slot;
    const height = max ? value / max * 51 : 0;
    const formatted = monthLabels ? shortMonth.format(Date.parse(`${key}-01`)) : key;
    if (monthLabels) {
      lines.push(text((x + slot / 2).toFixed(1), baseline + 16, formatted, 'small', 'middle'));
    }
    if (height > 0) {
      lines.push(rect((x + 1).toFixed(1), (baseline - height).toFixed(1), (slot - 2).toFixed(1),
        height.toFixed(1), monthLabels ? 'purple' : 'teal', 1, `${key} · ${count(value)}`));
    }
  }
  if (!monthLabels && entries.length > 0) {
    lines.push(text(17, baseline + 16, entries[0][0], 'small'),
      text(349, baseline + 16, entries.at(-1)[0], 'small', 'end'));
  }
  return lines;
}

function comparison(activity) {
  const prior = activity?.previousYear;
  if (!prior || !available(prior.totalContributions) || !available(activity.totalContributions)) return null;
  const currentEnd = activity.to?.slice(5);
  const previousEnd = prior.to?.slice(5);
  if (!(currentEnd === previousEnd || (currentEnd === '02-29' && previousEnd === '02-28'))) return null;
  return [
    [activity.from.slice(0, 4), activity.totalContributions],
    [prior.from.slice(0, 4), prior.totalContributions],
  ];
}

function cachedComparison(activity) {
  return activity.previousYearStale && activity.previousYearObservedAt
    ? `Prior-year data cached ${timestamp(activity.previousYearObservedAt)}.` : '';
}

function pairedBars(rows, y, format) {
  const max = Math.max(0, ...rows.map(([, value]) => value));
  return rows.flatMap(([label, value], index) => {
    const line = y + index * 22;
    const filled = max ? value / max * 164 : 0;
    return [
      text(17, line, label, 'small'),
      rect(104, line - 8, 164, 8, 'track', 4),
      filled > 0 ? rect(104, line - 8, filled.toFixed(1), 8, index ? 'purple' : 'teal', 4) : '',
      text(349, line, format(value), 'small', 'end'),
    ].filter(Boolean);
  });
}

export function renderContributions(model) {
  const activity = model.activity?.data;
  const days = activity?.days;
  if (!days?.length) {
    return svg(85, 'Contribution analytics', 'Verified daily contribution data is unavailable.', [
      text(16, 30, 'Contribution analytics', 'heading'),
      text(16, 57, 'Verified daily contribution data is unavailable.', 'muted'),
    ]);
  }
  const { months, weeks } = bucketContributionDays(days);
  const comparisonRows = comparison(activity);
  const priorCache = comparisonRows ? cachedComparison(activity) : '';
  const streaks = available(activity.streak) && available(activity.longestStreak)
    ? [['Current', activity.streak], ['Longest', activity.longestStreak]]
    : null;
  const description = [
    `${period(activity)}. ${count(activity.totalContributions)} contributions across ${count(activity.activeDays)} active days.`,
    `Current streak: ${duration(activity.streak)}. Longest streak: ${duration(activity.longestStreak)}.`,
    'The heatmap shows verified daily counts. Below it are monthly totals, Monday-start weekly totals, and streaks.',
    comparisonRows ? `Comparable year-to-date totals: ${comparisonRows.map(([year, total]) => `${year}: ${count(total)}`).join(', ')}.` : 'Comparable prior-year data is unavailable.',
    priorCache,
  ].filter(Boolean).join(' ');
  const lines = [
    text(16, 30, 'Contribution analytics', 'heading'),
    text(16, 51, period(activity), 'muted'),
    ...heatmap(days),
    ...periodBars(months, 'Monthly totals', 206, 12, true),
    ...periodBars(weeks, 'Weekly totals', 317, 54),
    text(16, 427, 'Contribution streaks', 'label'),
    ...(streaks ? pairedBars(streaks, 449, duration) : [text(16, 449, 'Streak data unavailable', 'small')]),
    text(16, 504, 'Same period last year', 'label'),
    ...(comparisonRows ? pairedBars(comparisonRows, 526, count) : [text(16, 526, 'Comparable prior-year data unavailable', 'small')]),
  ];
  if (priorCache) lines.push(text(16, 568, priorCache, 'small'));
  return svg(comparisonRows ? (priorCache ? 584 : 564) : 542, 'Contribution analytics', description, lines);
}

export function contributionsMarkdown(section) {
  const data = section?.data;
  if (!data?.days?.length) {
    return ['Verified daily contribution data is unavailable.', cached(section)].filter(Boolean).join('\n\n');
  }
  const summary = `${count(data.totalContributions)} contributions across ${count(data.activeDays)} active days from ${period(data)}.`;
  const comparable = comparison(data);
  const { months, weeks } = bucketContributionDays(data.days);
  return [
    `<img src="assets/contribution-analytics.svg" width="366" alt="${xml(summary)} Daily contribution heatmap, monthly totals, weekly totals and streak charts." />`,
    summary,
    cached(section),
    comparable
      ? `Same period last year: **${count(data.previousYear.totalContributions)}** contributions (${markdown(period(data.previousYear))}).`
      : 'Comparable prior-year data is unavailable.',
    comparable && cachedComparison(data),
    '<details>\n<summary>Monthly and weekly totals as text</summary>',
    `**Monthly** · ${months.map(([month, value]) => `${month}: ${count(value)}`).join(' · ')}`,
    `**Weekly, starting on Monday** · ${weeks.map(([week, value]) => `${week}: ${count(value)}`).join(' · ')}`,
    '</details>',
  ].filter(Boolean).join('\n\n');
}
