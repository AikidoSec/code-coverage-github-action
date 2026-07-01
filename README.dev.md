# Developer guide

This document covers how to set up the repository for development and how to run the action locally without pushing to GitHub.

For usage in workflows, see [README.md](./README.md).

## Prerequisites

- [Node.js](https://nodejs.org/) 24 or later (matches `node24` in `action.yml`)
- npm

## Setup

Install dependencies:

```bash
npm install
```

## npm scripts

| Script           | Description                                        |
| ---------------- | -------------------------------------------------- |
| `npm test`       | Run unit tests with Jest                           |
| `npm run lint`   | Lint `src/` and `__tests__/` with ESLint           |
| `npm run format` | Format JavaScript files with Prettier              |
| `npm run build`  | Bundle `src/main.js` into `dist/index.js` with ncc |
| `npm run local`  | Run the action locally via `@github/local-action`  |
| `npm run all`    | Format, lint, test, and build in one command       |

Before opening a pull request, run the full check:

```bash
npm run all
```

## Local action testing

This project uses [`@github/local-action`](https://github.com/github/local-action) to stub the GitHub Actions Toolkit environment. That lets you execute `src/main.js` on your machine with the same inputs and environment variables the action would receive in CI.

### 1. Create a `.env` file

Copy the example file and fill in your values:

```bash
cp .env.example .env
```

### 2. Configure environment variables

The `.env` file has two groups of variables.

#### Action inputs

GitHub Actions inputs are exposed as environment variables with an `INPUT_` prefix. Use the input name from `action.yml` in uppercase. **Keep hyphens — do not replace them with underscores.**

| Variable                | Required | Description                                        |
| ----------------------- | -------- | -------------------------------------------------- |
| `INPUT_AIKIDO-CI-TOKEN` | yes      | Your Aikido CI API token                           |
| `INPUT_LCOV-FILE-PATHS` | yes      | Path(s) to LCOV file(s), e.g. `coverage/lcov.info` |
| `INPUT_FAIL-ON-ERROR`   | no       | Defaults to `true`                                 |

For multiple LCOV files, separate paths with newlines, spaces, or commas (same parsing as in CI):

```dotenv
INPUT_LCOV-FILE-PATHS=packages/a/coverage/lcov.info
packages/b/coverage/lcov.info
```

#### GitHub context

In CI, GitHub sets repository metadata automatically. Locally, set these in `.env` so the upload payload is populated correctly (see `src/aikido.js`):

| Variable            | Example value                            |
| ------------------- | ---------------------------------------- |
| `GITHUB_REPOSITORY` | `AikidoSec/code-coverage-github-action`  |
| `GITHUB_SHA`        | `abc123def456...` (any valid commit SHA) |
| `GITHUB_REF_NAME`   | `main`                                   |

### 3. Provide an LCOV file

Point `INPUT_LCOV-FILE-PATHS` at an existing LCOV report. To generate one in this repo:

```bash
npm test
```

Jest writes coverage to `coverage/lcov.info`, which is the default path in `.env.example`.

### 4. Run the action

To locally test the action, set the environment variable `Development` in `.env` to `true`. This will set the endpoint url to staging. Testing against staging is advised as staging has all the required setup up and running.

```bash
npm run local
```

Or invoke the tool directly:

```bash
npx @github/local-action . src/main.js .env
```

On success you should see log lines similar to:

```
::info::Found 1 coverage file(s):
::info::Uploading coverage report to Aikido...
::info::Upload succeeded.
```

Set `ACTIONS_STEP_DEBUG=true` in `.env` (already enabled in `.env.example`) for more verbose output.

### 5. Debug in VS Code / Cursor

A launch configuration is included at `.vscode/launch.json`. Open the **Run and Debug** panel, select **Debug Local Action**, and start debugging. Breakpoints in `src/` will be hit when the action runs.

## Releasing

Releases are automated. Pushing a version tag triggers the [Release workflow](.github/workflows/release.yml), which runs tests, bundles `dist/`, commits the bundle to the release tag, and creates a GitHub Release.

### Create and push a tag

Use [semantic versioning](https://semver.org/) tags prefixed with `v`:

```bash
git checkout main
git pull
git tag v1.0.0
git push origin v1.0.0
```

The workflow runs on any tag matching `v*` (for example `v1.0.0` or `v1.0.1`).

Wait for the workflow to finish. It rebuilds `dist/`, commits it, and moves the version tag to that commit before creating the GitHub Release. Only then is the tag ready to use — pin consumers to the exact version (for example `AikidoSec/code-coverage-github-action@v1.0.0`), not `@main`.

### Publish to GitHub Marketplace

Publishing to GitHub Marketplace is a manual step in the GitHub UI. The release workflow does not do this for you. Follow the steps in the [GitHub docs](https://docs.github.com/en/actions/how-tos/create-and-publish-actions/publish-in-github-marketplace#publishing-an-action).

## Project layout

```
action.yml          Action metadata and inputs
src/
  main.js           Entry point (used for local runs)
  inputs.js         Reads action inputs via @actions/core
  mergeLcov.js      Merges multiple LCOV files
  aikido.js         Uploads coverage to the Aikido API
dist/
  index.js          Bundled output (used in CI workflows)
__tests__/          Jest unit tests
.env.example        Template for local testing
```

Local runs execute `src/main.js` directly. Published workflows use the bundled `dist/index.js` built by `npm run build`.

## Getting an Aikido CI token

1. In Aikido, open the CI integration detail page.
2. Generate an authentication token and copy it (shown only once).
3. Paste it into `.env` as `INPUT_AIKIDO-CI-TOKEN`.
