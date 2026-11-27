# Profile assets

- `skills-frontend.svg`, `skills-styling.svg`, `skills-tools.svg`, and `skills-learning.svg` are local copies of [Skill Icons](https://github.com/tandpfun/skill-icons). The README supplies the technology names and identifies TypeScript and Next.js as currently being learned.
- `language-distribution.svg` displays repository language bytes as a stacked bar with a matching text legend.
- `profile-data.json` stores the public data and its observation dates for repeat runs and temporary upstream failures.

`npm run update` regenerates the language chart, the data file, and the generated README sections. The chart uses local SVG with light and dark palettes selected by `prefers-color-scheme`. See [Setup and metric definitions](../docs/SETUP.md) for the data sources and refresh behavior.
