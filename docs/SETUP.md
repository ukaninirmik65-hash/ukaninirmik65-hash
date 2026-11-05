# Profile activity setup

The README's analytics are generated in this repository with Node.js 24, GitHub's REST and GraphQL APIs, and the public contribution calendar. There are no npm dependencies, paid services, or third-party statistics servers. The committed SVGs remain available between refreshes.

## Enable automatic refreshes

1. Keep this repository public and named `ukaninirmik65-hash/ukaninirmik65-hash`, with `main` as its default branch.
2. In **Settings → Actions → General**, allow GitHub Actions to run. The workflow requests `contents: write` only for its refresh job. Organization policy or branch rules may still restrict writes.
3. Open **Actions → Update profile activity → Run workflow** and select `main` for the initial run.
4. Confirm that the run succeeds and inspect any warnings in **Fetch public activity and render SVGs**. The commit step creates a commit only when the generated content changed.

**No repository secret is required for the normal setup.** The built-in `GITHUB_TOKEN` reads public data and pushes the generated files. Checkout does not persist credentials; the push uses a temporary askpass script removed when the step exits. Tokens are never written into the data snapshot or SVGs.

If a repository policy prevents GraphQL access, the generator can still use exact daily counts from GitHub's public contribution calendar. It omits unavailable contribution-type metrics. An optional repository Actions secret named `PROFILE_TOKEN` can supply a fine-grained personal access token with access only to this public profile repository and read-only public metadata. Do not grant access to private repositories for this dashboard. The workflow continues to push with its own `GITHUB_TOKEN`, so this optional token needs no write permission. A token lacking the requested read access will produce a warning and use the public fallback.

If branch protection rejects automated pushes, allow this workflow's bot through the applicable rule, or adapt the workflow to open a pull request. Do not weaken unrelated branch protections. No pull-request approval permission is required by the supplied workflow.

## When data changes

The refresh runs daily at **03:23 UTC / 08:53 Asia/Colombo**, on manual dispatch, and when this repository receives a star, is forked, or has a change to its generator, tests, package file, or workflow on `main`. GitHub may delay scheduled jobs. Scheduled workflows in inactive public repositories may be disabled by GitHub; re-enable the workflow in Actions if necessary.

GitHub does not send another repository's push, star, or fork event to a profile repository's workflow. Activity across the account is picked up by the daily refresh. For an immediate refresh, use **Run workflow**, or send this repository a `repository_dispatch` event with `event_type` set to `profile-update`. For example, an authorized caller can POST to:

```text
https://api.github.com/repos/ukaninirmik65-hash/ukaninirmik65-hash/dispatches
```

with this JSON body:

```json
{"event_type":"profile-update"}
```

The caller needs permission to dispatch to this repository. Keep that credential in the caller's Actions secret, never in a README, URL, or committed file. No cross-repository dispatch credential is needed for daily updates.

## What the charts mean

- Public repository, star, and fork totals include all pages of the account's owned public repositories. A repository's received stars and forks are counted once. Followers come from the public user API.
- Languages show GitHub-reported source-code **bytes**, summed over original public repositories. They describe repository contents, not skill level or time spent coding.
- Contributions and the calendar cover the displayed UTC calendar year through the fetched date. Daily counts reproduce the publicly visible GitHub calendar. If the account has enabled anonymous private contribution counts on its public profile, GitHub may include those counts. The generator collects no private repository details and never publishes additional token-only calendar activity. GitHub's native profile graph remains authoritative.
- Monthly and weekly charts aggregate those same daily counts. The current month and week can be incomplete. Repository activity is labeled using repository push dates; it is not a count of commits.
- Contribution-type counts are shown only when the API can reliably establish their public scope. An unavailable metric is omitted rather than replaced with zero.
- A contribution streak means consecutive calendar days with at least one contribution. Today's zero does not break a streak that was active yesterday. The longest streak is limited to the displayed calendar year.
- The source and data dates are embedded in generated assets. If optional data cannot be refreshed, retained data keeps its original date so its age remains visible. A failed required REST fetch leaves the last successful assets intact and fails the workflow.

## Local commands

With Node.js 24 installed:

```sh
npm test
npm run update
```

An authenticated run can read `GITHUB_TOKEN` from the current process environment. Never paste a token into a committed script. An unauthenticated run is suitable for initial generation and uses GitHub's lower public API rate limit. The generator uses bounded retries for temporary failures and preserves successful assets when required data cannot be fetched.

## Generated files

The updater owns only these files:

```text
assets/profile-data.json
assets/latest-repositories.svg
assets/latest-repositories-mobile.svg
assets/github-statistics.svg
assets/github-statistics-mobile.svg
assets/contribution-graph.svg
assets/contribution-graph-mobile.svg
assets/github-languages.svg
assets/github-languages-mobile.svg
```

The updater also refreshes the `LATEST_REPOSITORIES` block in `README.md`, so every displayed repository has a direct GitHub link. Desktop and mobile variants use the same underlying data. The README's `<picture>` elements select the appropriate variant. The JSON snapshot stores sanitized public data so that the source and calculations can be reviewed. It contains no credentials.

The workflow stages only this allowlist. Deterministic rendering and change detection avoid commits caused solely by a new run time. A new contribution date, changed public count, or changed repository data can legitimately produce a commit.

## Troubleshooting

Open the failed workflow's job log. A rate-limit or temporary upstream error is retried only within a short bound; a later scheduled/manual run can recover. If optional GraphQL data is unavailable, public calendar data remains usable. If the public calendar layout changes and exact counts cannot be parsed, the generator does not estimate values from cell colors.

The Capsule Render header/footer, Readme Typing SVG animation, and technology icons are cached in this repository as local SVG assets. Their upstream services are not needed to render the committed README. To change those static visuals, fetch and verify replacements separately; the activity workflow updates only its analytics allowlist. This implementation uses the generated contribution graph and does not reference an ungenerated snake image.

References: [GitHub workflow events and schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [GITHUB_TOKEN permissions](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token).
