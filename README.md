# Twitter Action

GitHub Action for installing the [`StanleyMasinde/twitter`](https://github.com/StanleyMasinde/twitter) CLI and publishing a tweet in a workflow.

The action installs the requested CLI version on every run, writes a temporary `twitter_cli` config from the supplied credentials, and executes `twitter tweet --body ...`.

## Usage

```yaml
name: Tweet

on:
  workflow_dispatch:
  release:
    types: [published]

jobs:
  tweet:
    runs-on: ubuntu-latest

    steps:
      - name: Publish tweet
        uses: StanleyMasinde/twitter-action@v1
        with:
          body: "A new release just shipped"
          twitter_version: latest
          consumer_key: ${{ secrets.TWITTER_CONSUMER_KEY }}
          consumer_secret: ${{ secrets.TWITTER_CONSUMER_SECRET }}
          access_token: ${{ secrets.TWITTER_ACCESS_TOKEN }}
          access_secret: ${{ secrets.TWITTER_ACCESS_SECRET }}
          bearer_token: ${{ secrets.TWITTER_BEARER_TOKEN }}
```

`body` can be built from workflow context just like any other action input. For example, when a release is published:

```yaml
- name: Publish release tweet
  uses: StanleyMasinde/twitter-action@v1
  with:
    body: "Released ${{ github.event.release.tag_name }}: ${{ github.event.release.html_url }}"
    twitter_version: latest
    consumer_key: ${{ secrets.TWITTER_CONSUMER_KEY }}
    consumer_secret: ${{ secrets.TWITTER_CONSUMER_SECRET }}
    access_token: ${{ secrets.TWITTER_ACCESS_TOKEN }}
    access_secret: ${{ secrets.TWITTER_ACCESS_SECRET }}
    bearer_token: ${{ secrets.TWITTER_BEARER_TOKEN }}
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `body` | Yes | None | Tweet body to publish. |
| `twitter_version` | No | `latest` | CLI version tag to install, for example `v1.5.0`. |
| `consumer_key` | Yes | None | Twitter API consumer key. |
| `consumer_secret` | Yes | None | Twitter API consumer secret. |
| `access_token` | Yes | None | Twitter API access token. |
| `access_secret` | Yes | None | Twitter API access token secret. |
| `bearer_token` | Yes | None | Twitter API bearer token. |

## Behavior

- The action downloads the installer script from the upstream `twitter` repository on each run.
- The CLI is installed into a runner-local directory under `RUNNER_TEMP`, not into a system path.
- Credentials are written to a temporary config file for the duration of the job.
- This action currently supports text tweets only. The underlying CLI supports images, but this action does not expose an `image` input yet.
- The runtime implementation uses the GitHub Actions toolkit packages, including `@actions/core` and `@actions/exec`.

## Development

This repository uses TypeScript, `pnpm`, and Vitest.

```bash
pnpm install
pnpm test
pnpm build
```

`pnpm` should be treated as a development dependency for this repository, not as a runtime requirement for action consumers. `pnpm build` type-checks the action and packages a distribution-ready [`dist/index.js`](dist/index.js) with Rollup.

## CI

CI is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml). It:

- installs `pnpm` explicitly
- installs dependencies with `pnpm install --frozen-lockfile`
- runs tests and the TypeScript build
- fails if `dist/` is not up to date

## Releasing Changes

If you change files under [`src/`](src), rebuild before publishing:

```bash
pnpm build
```

Commit the generated files under [`dist/`](dist) together with the source changes. This is required for JavaScript GitHub Actions because workflows execute the checked-in build output.
