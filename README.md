# Aikido Code Coverage GitHub Action

Collect [LCOV](https://github.com/linux-test-project/lcov) or [Cobertura](https://cobertura.github.io/cobertura/) XML code coverage reports produced by your test suite and upload them to [Aikido](https://www.aikido.dev/).

The action reads one or more reports from the paths you provide and uploads them **as-is** (no local merge), together with:

- a **`repository_source_paths`** list (filtered repo source paths) for path matching on the backend
- an **EOF** map (line counts for covered source files) so the backend can drop coverage past end-of-file

Authentication uses GitHub OIDC (keyless). The job that runs this action must grant
`id-token: write`. No API token or repository secret is required.

## Usage

Run your tests with coverage first, then point this action at the generated report.

Example YAML file (LCOV):

```yaml
name: Tests

on: push

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm test -- --coverage # produces coverage/lcov.info

      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  upload-coverage:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      id-token: write # required for upload
      contents: read # required for upload
    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          name: coverage
          path: coverage

      - name: Upload coverage to Aikido
        uses: AikidoSec/code-coverage-github-action@x.x.x #use the latest stable version
        with:
          file-paths: coverage/lcov.info
```

### Cobertura XML

```yaml
- name: Upload coverage to Aikido
  uses: AikidoSec/code-coverage-github-action@x.x.x #use the latest stable version
  with:
    file-paths: coverage/cobertura.xml
```

### Uploading multiple reports

Provide more than one path when separate packages or CI shards each emit their own report.
Mixed LCOV and Cobertura inputs are supported; the backend merges them.
Glob patterns are also supported (for example `packages/*/coverage/lcov.info`).

```yaml
- name: Upload coverage to Aikido
  uses: AikidoSec/code-coverage-github-action@x.x.x #use the latest stable version
  with:
    file-paths: |
      packages/*/coverage/lcov.info
      packages/b/coverage/cobertura.xml
```

### Monorepo with matrix jobs

When each package runs in its own job, coverage files live on separate runners. Use
[`actions/upload-artifact`](https://github.com/actions/upload-artifact) and
[`actions/download-artifact`](https://github.com/actions/download-artifact) to collect
reports in a final job, then upload once to Aikido.

Upload from every test job separately would send partial coverage and can race — always
merge into a single upload per commit.

Example YAML file:

```yaml
name: Tests

on: push

jobs:
  test:
    strategy:
      matrix:
        package: [packages/a, packages/b, packages/c]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm test --workspace=${{ matrix.package }} -- --coverage

      - uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ matrix.package }}
          path: ${{ matrix.package }}/coverage/lcov.info

  upload-coverage:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          path: coverage-reports
          pattern: coverage-*
          merge-multiple: true

      - name: Upload coverage to Aikido
        uses: AikidoSec/code-coverage-github-action@x.x.x #use the latest stable version
        with:
          file-paths: |
            coverage-reports/packages/a/coverage/lcov.info
            coverage-reports/packages/b/coverage/lcov.info
            coverage-reports/packages/c/coverage/lcov.info
```

`merge-multiple: true` extracts every matched artifact into one directory while preserving
each file's path, so the paths above match what `upload-artifact` stored. Adjust the matrix
and paths to match your repository layout.

Grant `id-token: write` on the job that runs this action (`upload-coverage` above), not on
the matrix test jobs.

### Monorepo that tests only changed paths

Run every package and upload every report on each run. Each upload replaces coverage for that repository and branch. Aikido does not merge it with the previous upload. If you upload only the packages that ran, the skipped packages are removed from Aikido until a later upload includes them again.

Skipping unchanged packages is an optimization. Keep one artifact per package. When a package changes, run its tests and publish that report. When it does not change, download the artifact from the last successful run and publish the same report again. The upload job then downloads every artifact from the current run and passes every path to this action.

Run coverage for every package once on the main branch before you start skipping unchanged packages. The upload step expects a report for every package, so the job fails until those artifacts exist on main.

```yaml
name: Coverage

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        app: [web, api]
    permissions:
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Did this app change?
        id: changes
        run: |
          if git diff --name-only "${{ github.event.before }}" "${{ github.sha }}" | grep -q "^apps/${{ matrix.app }}/"; then
            echo "changed=true" >> "$GITHUB_OUTPUT"
          else
            echo "changed=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Test the app that changed
        if: steps.changes.outputs.changed == 'true'
        run: npm test --workspace=apps/${{ matrix.app }} -- --coverage

      - name: Reuse the latest available report when nothing changed
        if: steps.changes.outputs.changed == 'false'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          mkdir -p "apps/${{ matrix.app }}/coverage"
          run_id=$(gh run list --workflow coverage.yml --branch main --status success --limit 1 --json databaseId --jq '.[0].databaseId')
          gh run download "$run_id" --name "coverage-${{ matrix.app }}" --dir "apps/${{ matrix.app }}/coverage"

      - uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ matrix.app }}
          path: apps/${{ matrix.app }}/coverage/lcov.info

  upload-coverage:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
      actions: read
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          pattern: coverage-*
          path: coverage-reports

      - uses: AikidoSec/code-coverage-github-action@latest
        with:
          file-paths: |
            coverage-reports/coverage-web/lcov.info
            coverage-reports/coverage-api/lcov.info
```

Name the workflow file `coverage.yml`. Each test job either creates a new `lcov.info` or downloads the one saved on main, and the upload job sends both. On a pull request, download the saved reports from `main`.

## Inputs

| Input           | Required | Default | Description                                                                                         |
| --------------- | -------- | ------- | --------------------------------------------------------------------------------------------------- |
| `file-paths`    | yes      | —       | Path(s) or glob pattern(s) to coverage report(s). Newline-, space-, or comma-separated. Format detected from filename. |
| `region`        | no       | `eu`    | Aikido region for upload and OIDC audience: `eu`, `us`, `au`, or `us-gov`.                          |
| `fail-on-error` | no       | `true`  | Fail the action if reading or upload fails. Set to `false` to emit a warning instead.               |

### Region

Set `region` to match your Aikido workspace. The value selects both the API host and the OIDC
token audience.

```yaml
- name: Upload coverage to Aikido
  uses: AikidoSec/code-coverage-github-action@x.x.x #use the latest stable version
  with:
    file-paths: coverage/lcov.info
    region: us
```

## Authentication

The action authenticates with GitHub OIDC. The workflow job must grant `id-token: write`
so GitHub can mint a JWT for Aikido. Setting any `permissions` key resets the rest to
none, so also grant `contents: read` if the job checks out the repository.

```yaml
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npm test -- --coverage

      - uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: coverage/

  upload-coverage:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      id-token: write # required for upload
      contents: read # required for upload
    steps:
      - uses: actions/checkout@v4

      - uses: actions/download-artifact@v4
        with:
          name: coverage
          path: coverage

      - name: Upload coverage to Aikido
        uses: AikidoSec/code-coverage-github-action@x.x.x #use the latest stable version
        with:
          file-paths: coverage/lcov.info
```
