# Aikido Code Coverage GitHub Action

Collect an [LCOV](https://github.com/linux-test-project/lcov) code coverage report produced by your
test suite and upload it to [Aikido](https://www.aikido.dev/).

The action reads one or more LCOV reports from the paths you provide. When multiple reports are
given, it merges them into a single file before upload. It then POSTs the LCOV content to the Aikido CI code coverage API together with the
repository name, commit SHA, and branch name.

## Usage

Run your tests with coverage first, then point this action at the generated LCOV file.

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm test -- --coverage # produces coverage/lcov.info

      - name: Upload coverage to Aikido
        uses: AikidoSec/code-coverage-github-action@v1
        with:
          aikido-ci-token: ${{ secrets.AIKIDO_CI_TOKEN }}
          lcov-file-paths: coverage/lcov.info
```

### Uploading multiple reports

Provide more than one path when separate packages or CI shards each emit their own `lcov.info`. The
action merges all inputs into one upload.

```yaml
- name: Upload coverage to Aikido
  uses: AikidoSec/code-coverage-github-action@v1
  with:
    aikido-ci-token: ${{ secrets.AIKIDO_CI_TOKEN }}
    lcov-file-paths: |
      packages/a/coverage/lcov.info
      packages/b/coverage/lcov.info
```

### Monorepo with matrix jobs

When each package runs in its own job, LCOV files live on separate runners. Use
[`actions/upload-artifact`](https://github.com/actions/upload-artifact) and
[`actions/download-artifact`](https://github.com/actions/download-artifact) to collect
reports in a final job, then upload once to Aikido.

Upload from every test job separately would send partial coverage and can race — always
merge into a single upload per commit.

```yaml
name: Tests

on: [push, pull_request]

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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/download-artifact@v4
        with:
          path: coverage-reports
          pattern: coverage-*
          merge-multiple: true

      - name: Upload coverage to Aikido
        uses: AikidoSec/code-coverage-github-action@v1
        with:
          aikido-ci-token: ${{ secrets.AIKIDO_CI_TOKEN }}
          lcov-file-paths: |
            coverage-reports/packages/a/coverage/lcov.info
            coverage-reports/packages/b/coverage/lcov.info
            coverage-reports/packages/c/coverage/lcov.info
```

`merge-multiple: true` extracts every matched artifact into one directory while preserving
each file's path, so the paths above match what `upload-artifact` stored. Adjust the matrix
and paths to match your repository layout.

## Inputs

| Input             | Required | Default | Description                                                                           |
| ----------------- | -------- | ------- | ------------------------------------------------------------------------------------- |
| `aikido-ci-token` | no\*     | —       | Aikido CI API token. Mutually exclusive with `use-oidc`.                              |
| `use-oidc`        | no       | `false` | Authenticate with GitHub OIDC instead of a token. Requires `id-token: write`.       |
| `lcov-file-paths` | yes      | —       | Path(s) to the LCOV report file(s).                                                   |
| `fail-on-error`   | no       | `true`  | Fail the action if reading or upload fails. Set to `false` to emit a warning instead. |

\* One of `aikido-ci-token` or `use-oidc: true` is required.

## Authentication

You can authenticate with either a CI API token (secret) or GitHub OIDC (keyless).

### API token (default)

1. In Aikido, open the CI integration detail page.
2. Generate an authentication token and copy it (it is shown only once).
3. Add it as a repository secret, e.g. `AIKIDO_CI_TOKEN`, and pass it via the `aikido-ci-token` input.

### GitHub OIDC (keyless)

Set `use-oidc: true` instead of `aikido-ci-token`. The workflow job must grant `id-token: write` so GitHub can mint a JWT for Aikido.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npm test -- --coverage

      - name: Upload coverage to Aikido
        uses: AikidoSec/code-coverage-github-action@v1
        with:
          use-oidc: true
          lcov-file-paths: coverage/lcov.info
```

`aikido-ci-token` and `use-oidc` are mutually exclusive — provide one or the other.
