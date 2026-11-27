const number = new Intl.NumberFormat('en-US');
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const prohibitedText = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ufffe\uffff\uD800-\uDFFF]/gu;
const displayText = value => String(value ?? '').replace(/\s+/gu, ' ').replace(prohibitedText, '').trim();
const xml = value => displayText(value).replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);
const markdown = value => displayText(value).replace(/[\\`*_[\]{}()#!|~:+<>&@]/g, character => `&#${character.charCodeAt(0)};`);
const numeric = value => Number.isSafeInteger(value) && value >= 0 ? number.format(value) : 'Unavailable';
const percent = value => value > 0 && value < 0.01 ? '<0.01%' : `${decimal.format(value)}%`;
const timestamp = value => `${value.length === 10 ? value : `${value.slice(0, 10)} ${value.slice(11, 16)}`} UTC`;

const activityAxes = [
  { key: 'reviews', label: 'Code reviews', dx: 0, dy: -1, x: 175, y: 24, anchor: 'middle' },
  { key: 'issues', label: 'Issues', dx: 1, dy: 0, x: 336, y: 121, anchor: 'end' },
  { key: 'pullRequests', label: 'Pull requests', dx: 0, dy: 1, x: 175, y: 224, anchor: 'middle' },
  { key: 'commits', label: 'Commits', dx: -1, dy: 0, x: 14, y: 121, anchor: 'start' },
];

const namedColors = new Map(Object.entries({
  JavaScript: ['#9a6b04', '#e6c652'],
  TypeScript: ['#2369ad', '#73a9e5'],
  CSS: ['#7347ad', '#b88cf1'],
  HTML: ['#be4c36', '#ed896f'],
  Python: ['#3c7092', '#82b4d9'],
  Ruby: ['#b43f67', '#e97c9f'],
  Go: ['#087d96', '#64c6d6'],
  Shell: ['#357649', '#83c59a'],
}));
const fallbackColors = [
  ['#327e73', '#6bbdaf'], ['#3d6ca5', '#7fa9df'], ['#6c579c', '#b29adb'],
  ['#8c5a52', '#d9a093'], ['#6d6522', '#c3b669'], ['#8d4775', '#d28db5'],
];

function linkUrl(raw, githubOnly = false) {
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search ||
        (githubOnly && url.origin !== 'https://github.com')) return null;
    return url.href.replace(/[<>\s]/g, encodeURIComponent);
  } catch {
    return null;
  }
}

function repositoryLink(name, url) {
  const href = linkUrl(url, true);
  return href ? `[${markdown(name)}](<${href}>)` : markdown(name);
}

function staleNotice(section) {
  return section?.stale && section.observedAt
    ? `\n\n_Cached data from ${timestamp(section.observedAt)}._`
    : '';
}

function period(activity) {
  return activity?.from && activity.to
    ? `${markdown(activity.from)} to ${markdown(activity.to)} UTC`
    : 'Current calendar year (UTC)';
}

function projectCard(project) {
  const source = linkUrl(project.url, true);
  const demo = linkUrl(project.demoUrl);
  const links = [
    source ? `<a href="${xml(source)}">${xml(project.name)}</a>` : xml(project.name),
    demo ? `<a href="${xml(demo)}">Live demo</a>` : null,
  ].filter(Boolean);
  const details = [
    project.language && xml(project.language),
    Number.isSafeInteger(project.stars) && `${numeric(project.stars)} ${project.stars === 1 ? 'star' : 'stars'}`,
    project.forks > 0 && `${numeric(project.forks)} ${project.forks === 1 ? 'fork' : 'forks'}`,
  ].filter(Boolean).join(' · ');
  const stack = (project.stack ?? []).map(item => `<code>${xml(item)}</code>`).join(' ');
  return [
    '    <td width="50%" valign="top">',
    `      <h3>${xml(project.title || project.name)}</h3>`,
    project.description && `      <p>${xml(project.description)}</p>`,
    stack && `      <p>${stack}</p>`,
    details && `      <p>${details}</p>`,
    project.updatedAt && `      <p>Code updated ${xml(project.updatedAt)}</p>`,
    `      <p>${links.join(' · ')}</p>`,
    '    </td>',
  ].filter(Boolean).join('\n');
}

function projectsMarkdown(section) {
  if (!section?.data) return 'Project data is unavailable.';
  if (!section.data.length) return 'No eligible public projects were reported.';
  const rows = [];
  for (let i = 0; i < section.data.length; i += 2) {
    rows.push([
      '  <tr>',
      ...section.data.slice(i, i + 2).map(projectCard),
      '  </tr>',
    ].join('\n'));
  }
  return `<table>\n${rows.join('\n')}\n</table>${staleNotice(section)}`;
}

function statsMarkdown(stats, activity) {
  const account = stats?.data;
  const overview = activity?.data;
  const counts = overview?.counts;
  const streak = overview?.streak;

  const accountRows = account ? [
    '| Repos | Stars | Followers |',
    '| ---: | ---: | ---: |',
    `| ${numeric(account.repositories)} | ${numeric(account.stars)} | ${numeric(account.followers)} |`,
  ].join('\n') : 'Public account metrics are unavailable.';
  const contributionRows = [
    '| Commits | PRs | Profile streak |',
    '| ---: | ---: | ---: |',
    `| ${numeric(counts?.commits)} | ${numeric(counts?.pullRequests)} | ${streak == null ? 'Unavailable' : `${numeric(streak)} ${streak === 1 ? 'day' : 'days'}`} |`,
  ].join('\n');

  return [
    `**Public account totals**\n\n${accountRows}${staleNotice(stats)}`,
    `**Public contributions** · ${period(overview)}\n\n${contributionRows}${staleNotice(activity)}`,
  ].join('\n\n');
}

export function activityPercentages(counts) {
  if (!counts || activityAxes.some(({ key }) => !Number.isSafeInteger(counts[key]) || counts[key] < 0)) return null;
  const total = activityAxes.reduce((sum, { key }) => sum + counts[key], 0);
  return Object.fromEntries(activityAxes.map(({ key }) => [key, total ? counts[key] / total * 100 : 0]));
}

const radarCenter = { x: 175, y: 130 };
const radarRadius = 73;

export function radarPoints(percentages) {
  return activityAxes.map(({ key, dx, dy }) => ({
    x: radarCenter.x + dx * radarRadius * percentages[key] / 100,
    y: radarCenter.y + dy * radarRadius * percentages[key] / 100,
  }));
}

function activitySummary(counts) {
  const percentages = activityPercentages(counts);
  if (!percentages) return 'Contribution counts are unavailable.';
  if (Object.values(percentages).every(value => value === 0)) return 'GitHub reported no contributions in these four categories.';
  return activityAxes.map(({ key, label }) => `${label} ${percent(percentages[key])}`).join(', ');
}

function activityMarkdown(section) {
  const activity = section?.data;
  const counts = activity?.counts;
  const repositories = activity?.repositories?.map(({ name, url }) => repositoryLink(name, url));
  const links = repositories == null ? 'Repository data is unavailable.'
    : repositories.length ? repositories.map(link => `- ${link}`).join('\n')
      : 'No recently contributed public repositories were reported.';
  return [
    `**Public contributions** · ${period(activity)}${staleNotice(section)}`,
    `<img align="right" src="assets/activity-overview.svg" width="350" alt="${xml(`Contribution breakdown. ${activitySummary(counts)}`)}" />`,
    [
      `**Commits** · ${numeric(counts?.commits)}`,
      `**Pull requests** · ${numeric(counts?.pullRequests)}`,
      `**Code reviews** · ${numeric(counts?.reviews)}`,
      `**Issues** · ${numeric(counts?.issues)}`,
    ].join('<br />'),
    `**Recently contributed public repositories**\n\n${links}`,
    '<br clear="both" />',
  ].join('\n\n');
}

function languagesMarkdown(section) {
  const distribution = section?.data;
  if (!distribution) return 'Language data is unavailable.';
  if (!distribution.length) return 'GitHub reported no language bytes for eligible repositories.';
  const legend = distribution.map(({ name, percentage }) => `${displayText(name)} ${percent(percentage)}`).join(', ');
  return [
    `<img src="assets/language-distribution.svg" width="366" alt="${xml(`Share of repository language bytes. ${legend}`)}" />`,
    `Based on language bytes in eligible public repositories. [Repository exclusions](docs/SETUP.md#language-distribution)${staleNotice(section)}`,
  ].join('\n\n');
}

function recentMarkdown(section) {
  const activity = section?.data;
  if (!activity) return 'Recent public activity is unavailable.';
  if (!activity.length) return `No recent public development activity was reported.${staleNotice(section)}`;
  const entries = activity.map(({ kind, title, repo, date, url }) =>
    `- ${repositoryLink(title, url)} · ${markdown(kind)} · ${markdown(repo)} · ${markdown(date)}`);
  return `${entries.join('\n')}${staleNotice(section)}`;
}

export function renderReadmeSections(model) {
  return {
    PROJECTS: projectsMarkdown(model.projects),
    STATS: statsMarkdown(model.stats, model.activity),
    ACTIVITY_OVERVIEW: activityMarkdown(model.activity),
    LANGUAGES: languagesMarkdown(model.languages),
    RECENT_ACTIVITY: recentMarkdown(model.recent),
    LAST_UPDATED: model.lastSuccessfulAt
      ? `**${timestamp(model.lastSuccessfulAt)}** · Last complete data update.`
      : 'A complete refresh timestamp is unavailable.',
  };
}

function svg(width, height, title, description, body, { styles = '', darkStyles = '' } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${xml(title)}</title>
  <desc id="description">${xml(description)}</desc>
  <style>
    :root { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .surface { fill: #f6f8fc; stroke: #c4d0de; }
    .label { fill: #182e4a; font-size: 15px; font-weight: 600; }
    .value { fill: #3c526a; font-size: 15px; font-variant-numeric: tabular-nums; }
    .grid { fill: none; stroke: #a3b3c6; }
    .area { fill: #147445; fill-opacity: .18; stroke: #147445; stroke-width: 2; stroke-linejoin: round; }
    .point { fill: #147445; }${styles ? `\n    ${styles}` : ''}
    @media (prefers-color-scheme: dark) {
      .surface { fill: #111b2b; stroke: #33465c; }
      .label { fill: #eef3f9; }
      .value { fill: #b9c8da; }
      .grid { stroke: #52657d; }
      .area { fill: #62c88c; fill-opacity: .21; stroke: #62c88c; }
      .point { fill: #62c88c; }${darkStyles ? `\n      ${darkStyles}` : ''}
    }
  </style>
  <rect class="surface" x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="10" />
${body}
</svg>
`;
}

function chartText(x, y, value, style, alignment = 'start') {
  return `<text class="${style}" x="${x}" y="${y}" text-anchor="${alignment}">${xml(value)}</text>`;
}

function renderActivity(activity) {
  const title = 'Development activity breakdown';
  const summary = activitySummary(activity?.counts);
  const percentages = activityPercentages(activity?.counts);
  if (!percentages || Object.values(percentages).every(value => value === 0)) {
    const text = percentages ? 'No contributions in this period' : 'Contribution counts unavailable';
    return svg(350, 88, title, summary, `  ${chartText(175, 49, text, 'label', 'middle')}`);
  }

  const pointsString = points => points.map(({ x, y }) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');
  const rings = [25, 50, 75, 100].map(level => {
    const values = Object.fromEntries(activityAxes.map(({ key }) => [key, level]));
    return `  <polygon class="grid" points="${pointsString(radarPoints(values))}" />`;
  });
  const points = radarPoints(percentages);
  const { x, y } = radarCenter;
  const details = [
    ...rings,
    `  <path class="grid" d="M${x - radarRadius} ${y}H${x + radarRadius} M${x} ${y - radarRadius}V${y + radarRadius}" />`,
    `  <polygon class="area" points="${pointsString(points)}" />`,
    ...points.flatMap((point, index) => percentages[activityAxes[index].key] > 0
      ? [`  <circle class="point" cx="${point.x.toFixed(3)}" cy="${point.y.toFixed(3)}" r="3.5" />`]
      : []),
    ...activityAxes.flatMap(axis => [
      `  ${chartText(axis.x, axis.y, axis.label, 'label', axis.anchor)}`,
      `  ${chartText(axis.x, axis.y + 19, percent(percentages[axis.key]), 'value', axis.anchor)}`,
    ]),
  ];
  return svg(350, 258, title, summary, details.join('\n'));
}

function languageColor(name) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
  return namedColors.get(name) ?? fallbackColors[hash % fallbackColors.length];
}

function renderLanguages(distribution) {
  const title = 'Programming language distribution';
  if (!distribution?.length) {
    const state = distribution ? 'No language bytes reported' : 'Language data unavailable';
    return svg(366, 75, title, state, `  ${chartText(183, 43, state, 'label', 'middle')}`);
  }
  const xStart = 15;
  const barWidth = 336;
  let x = xStart;
  const segments = [];
  const legend = [];
  const lightStyles = [];
  const darkStyles = [];
  const description = distribution.map(({ name, percentage }) => `${name} ${percent(percentage)}`).join(', ');

  for (const [i, { name, percentage }] of distribution.entries()) {
    const colorClass = `lang-${i}`;
    const [light, dark] = languageColor(name);
    lightStyles.push(`.${colorClass} { fill: ${light}; }`);
    darkStyles.push(`.${colorClass} { fill: ${dark}; }`);
    const width = i === distribution.length - 1 ? xStart + barWidth - x : barWidth * percentage / 100;
    segments.push(`    <rect class="${colorClass}" x="${x.toFixed(3)}" y="15" width="${width.toFixed(3)}" height="13" />`);
    x += width;
    const y = 53 + i * 24;
    legend.push(
      `  <circle class="${colorClass}" cx="21" cy="${y - 5}" r="5" />`,
      `  ${chartText(34, y, name, 'label')}`,
      `  ${chartText(349, y, percent(percentage), 'value', 'end')}`,
    );
  }
  return svg(366, 61 + (distribution.length - 1) * 24, title, description, [
    '  <defs><clipPath id="bar"><rect x="15" y="15" width="336" height="13" rx="6" /></clipPath></defs>',
    '  <g clip-path="url(#bar)">',
    ...segments,
    '  </g>',
    ...legend,
  ].join('\n'), { styles: lightStyles.join(' '), darkStyles: darkStyles.join(' ') });
}

export function renderAssets(model) {
  return {
    'activity-overview.svg': renderActivity(model.activity?.data),
    'language-distribution.svg': renderLanguages(model.languages?.data),
  };
}
