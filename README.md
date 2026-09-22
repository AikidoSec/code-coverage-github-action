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
        uses: AikidoSec/code-coverage-github-action@v1.1.0
        with:
          file-paths: coverage/lcov.info
```

### Cobertura XML

```yaml
- name: Upload coverage to Aikido
  uses: AikidoSec/code-coverage-github-action@v1.1.0
  with:
    file-paths: coverage/cobertura.xml
```

### Uploading multiple reports

Provide more than one path when separate packages or CI shards each emit their own report.
Mixed LCOV and Cobertura inputs are supported; the backend merges them.

```yaml
- name: Upload coverage to Aikido
  uses: AikidoSec/code-coverage-github-action@v1.1.0
  with:
    file-paths: |
      packages/a/coverage/lcov.info
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
        uses: AikidoSec/code-coverage-github-action@v1.1.0
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

## Inputs

| Input           | Required | Default | Description                                                                                         |
| --------------- | -------- | ------- | --------------------------------------------------------------------------------------------------- |
| `file-paths`    | yes      | —       | Path(s) to coverage report(s). Newline-, space-, or comma-separated. Format detected from filename. |
| `region`        | no       | `eu`    | Aikido region for upload and OIDC audience: `eu`, `us`, `au`, or `us-gov`.                          |
| `fail-on-error` | no       | `true`  | Fail the action if reading or upload fails. Set to `false` to emit a warning instead.               |

### Region

Set `region` to match your Aikido workspace. The value selects both the API host and the OIDC
token audience.

```yaml
- name: Upload coverage to Aikido
  uses: AikidoSec/code-coverage-github-action@v1.1.0
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
        uses: AikidoSec/code-coverage-github-action@v1.1.0
        with:
          file-paths: coverage/lcov.info
```
