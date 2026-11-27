# Profile automation

The profile README is generated in this repository with Node.js 24 and the official GitHub REST and GraphQL APIs. The generator validates and normalizes the public API data, calculates metrics, and renders Markdown and local SVGs. The committed JSON snapshot and SVGs keep the profile readable between updates.

## Enable automatic updates

1. In the profile repository, allow GitHub Actions under **Settings → Actions → General**.
2. Open **Actions → Update profile activity → Run workflow**, select the default branch (`main`), and start the first refresh.
3. Check the run's result and the generated profile. A pass means the data and output validation completed. A failed run's log identifies the source or publish step that needs attention.

**Permissions.** The verification job uses `contents: read` and receives no profile data credential. Only the default-branch refresh job requests `contents: write`. Its built-in `GITHUB_TOKEN` is used for the normal API requests and for pushing generated files. Checkout leaves Git credentials unpersisted, and the push uses a temporary Git askpass helper that is removed on exit.

**Optional GraphQL credential.** Try the built-in token first. If the workflow log indicates that GitHub's repository-scoped token cannot read the required public contribution data, create a fine-grained personal access token with resource owner `ukaninirmik65-hash`, limited to the public profile repository, with the automatically granted **Metadata: read-only** permission. Give it an expiration date and add it under **Settings → Secrets and variables → Actions → New repository secret** as `PROFILE_TOKEN`. Fine-grained tokens include access to public resources. Keep the token's selection limited to public data. The optional token is for GraphQL reads, while generated commits use `GITHUB_TOKEN`. [GraphQL authentication](https://docs.github.com/en/graphql/guides/forming-calls-with-graphql) · [Actions token scope](https://docs.github.com/en/actions/concepts/security/github_token)

## Refresh schedule

- Scheduled refreshes start at **00:23, 06:23, 12:23, and 18:23 UTC** (**05:53, 11:53, 17:53, and 23:53 Asia/Colombo**). GitHub may delay scheduled runs and may disable schedules after extended inactivity in a public repository. [Workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- Manual dispatch, a relevant push to `main`, a new star, and a fork can trigger a refresh. Pull requests and manual dispatches on other branches run offline verification with read-only permissions.
- The profile repository cannot receive ordinary push events from other repositories. Scheduled runs pick up those updates. For an immediate cross-repository refresh, an authorized caller can send a `repository_dispatch` event with `event_type` set to `profile-update` to `POST /repos/ukaninirmik65-hash/ukaninirmik65-hash/dispatches`. No cross-repository credential is needed for the scheduled refresh. [Repository dispatch permissions](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event)

Default-branch refreshes serialize through a workflow concurrency group. Generated commits use a fast-forward-only push, so concurrent maintainer changes remain intact. Rerun a job after a non-fast-forward rejection so the generator can start from the new default-branch tip. Automated commits do not trigger another refresh.

## Data and calculations

| Section | Source and scope |
| --- | --- |
| Featured Projects | Curated projects retain their documented descriptions and technologies. GitHub REST supplies canonical names, primary languages, stars, forks, and the most recent meaningful default-branch commit. Extra slots can show an original, active public repository with a description and either a `featured` topic or both a star and a detected language. The profile repository, archived repositories, forks, and the previously excluded `demo` and `motiwalaperfumes-clone` repositories are ineligible for automatic selection. Demo links use verified public deployment URLs. |
| GitHub Analytics | GitHub REST returns the public follower count and the paginated list of repositories owned by this account. Repository and star totals include the profile repository. Contribution counts are for the displayed UTC year-to-date period. |
| Contribution metrics | GitHub GraphQL supplies year-to-date counts. Repository groups are reconciled to the API totals before public commit and pull request counts are displayed. |
| Contribution streak | The generator verifies the signed-out GitHub profile calendar against GraphQL's daily data. A credential with broader visibility can still produce a streak using only the dates and counts GitHub already shows on the signed-out profile. This public view may include GitHub's anonymized counts if the account has enabled them. A streak that reached yesterday remains current while today's count is still zero. Individual dates and counts stay out of the saved snapshot and SVGs. |
| Programming Language Distribution | GitHub's repository languages endpoint returns source-code bytes. Each share divides a language's aggregate bytes by the total included bytes. The sample measures source code, including public practice projects. |
| Recent Development Activity | The public events feed supplies commits, pull requests, issues, and releases where available. If the feed yields fewer than five verified entries, the generator looks for attributed default-branch commits within the last 90 days across up to eight recently pushed original public repositories. GitHub's feed keeps up to 300 events over 30 days and may lag up to six hours. |

Recent activity excludes automated profile updates, bots, and duplicates. Featured project source and deployment evidence is recorded separately. [Project verification](PROJECT-VERIFICATION.md) · [GitHub public events](https://docs.github.com/en/rest/activity/events) · [Contribution collection](https://docs.github.com/en/graphql/reference/users#contributionscollection)

### Language distribution

The sample includes source bytes from original, active public repositories, including public practice projects. It excludes forks, archived and disabled repositories, and the profile automation repository. Empty language responses contribute zero bytes. [Repository language data](https://docs.github.com/en/rest/repos/repos#list-repository-languages)

## Local development

Use Node.js 24. There are no third-party npm dependencies to install.

```sh
npm test
npm run update
npm run validate
```

`npm test` and `npm run validate` are offline. `npm run update` accepts the API credentials from the process environment. Set `GITHUB_TOKEN` for authenticated REST and GraphQL calls, or `PROFILE_TOKEN` for GraphQL. An unauthenticated run can update the public REST data under GitHub's lower rate limit. Never store API credentials in tracked files.

Generated output is limited to `assets/profile-data.json`, `assets/language-distribution.svg`, and the named comment blocks in `README.md`. Keep personal, experience, and contact edits outside those generated blocks. The workflow validates the complete generated output before staging its allowlist, and creates a commit only when those files change.

The README timestamp shows when the complete saved snapshot was last updated. Successful checks that produce the same saved data keep the displayed timestamp and file contents. Actions records the result and time of each check.

## Recovery and limitations

- A recoverable API failure leaves the affected section's last verified values and data date in place or shows an unavailable state when no verified value exists. The workflow publishes the validated status change and then flags the refresh as incomplete. Unexpected generator failures stop publication.
- A successful zero count differs from an unavailable data source. Bounded retries handle transient network or rate-limit errors until the next run can try again.
- If branch policy blocks the automation from writing the default branch, the generated files remain at their previous committed state. The repository's existing branch policy determines whether the workflow may publish directly.
