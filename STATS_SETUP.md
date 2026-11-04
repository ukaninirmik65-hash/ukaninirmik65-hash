# Live GitHub statistics setup

1. Create a **classic personal access token** while signed in as `ukaninirmik65-hash`, with `repo` and `read:user` scopes. Set an expiry and renew it before expiry. This implementation deliberately requires the owner's full private-repository visibility and validates repository counts; a selected-repository token is not sufficient.
2. In this repository, open **Settings → Secrets and variables → Actions → New repository secret**. Name it `STATS_TOKEN` and paste the token there. Never paste it into README, code, issues, or chat.
3. Merge these changes and run **Actions → Update live GitHub statistics → Run workflow** on `main`. It also runs daily at 01:23 UTC and when updater code changes.
4. Check the run succeeds and the README's successful-update timestamp changes. If branch protection prevents the bot push, allow this workflow's write through your repository policy or adapt it to open update PRs.

The built-in `GITHUB_TOKEN` only writes the generated README in this repository. The separate `STATS_TOKEN` reads your account and repositories. No dependencies are installed by the updater.

## Definitions and limits

- Owned repositories include public/private, forks, archived repositories, and empty repositories. Organization-owned and collaborator-only repositories do not count as owned.
- All-time commits are unique SHAs reachable from **all current branches**, filtered by the GitHub author username and verified against the account's numeric ID. Identical commits shared across forks or branches count once globally. Merge commits authored by the account count. Commits where the account is only the committer or a co-author trailer do not count.
- This is all currently accessible history, without a date cutoff. GitHub cannot supply deleted repositories, deleted branch-only commits, or identify commits with emails not linked to the account. Tags-only history is outside the current-branches definition.
- Contributions sum GitHub's calendar totals in separate calendar-year windows since account creation. GitHub eligibility, private contribution visibility settings, and API visibility apply. Enable private contribution visibility on the profile for private calendar events. These events are distinct from all-time commit history.
- Code reviews sum `totalPullRequestReviewContributions` per year. This is GitHub's contribution count, which can differ from the number of individual review submissions. PR and issue totals use the user's GraphQL authored connections, across all repositories visible to the token.
- Language percentages sum GitHub language bytes over owned repositories, including forks and private repositories. They describe repository content, not personal authorship. Only aggregate counts and language totals appear publicly.
- Repository listings, branches, and commits paginate at 100 entries. Branch heads are pinned while scanning. The API is not a transactional snapshot; rerun if repositories or history change during a scan.
- Network errors, secondary limits, primary rate limits, and server errors retry with bounded waits. Missing access, coverage mismatches, GraphQL partial errors, exhausted retries, or timeouts fail the run. Existing published statistics stay unchanged. A 409 explicitly identifying an empty repository counts as zero; other failures never silently count as zero.
- A full history scan can take many requests on large accounts. The job has a 180-minute budget; a failure preserves the previous timestamp. No private repository names, commit messages, or source code are written to the README.

## Local validation

Run `node --test scripts/update-stats.test.mjs` (Node 22+). To perform an authenticated scan, provide `STATS_TOKEN` through your environment and run `node scripts/update-stats.mjs` from the repository root.

The old README linked a snake workflow that did not exist. That broken section is removed; this change focuses on live statistics.
