jest.mock('@actions/core');

const core = require('@actions/core');
const { readInputs } = require('../src/inputs');

describe('readInputs', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: 'AikidoSec/code-coverage-github-action',
      GITHUB_SHA: 'abc123def456',
      GITHUB_REF_NAME: 'main',
    };

    core.getInput.mockImplementation((name) => {
      const values = {
        'aikido-ci-token': 'secret-token',
        'lcov-file-paths': 'coverage/lcov.info',
      };
      return values[name] ?? '';
    });
    core.getBooleanInput.mockReturnValue(true);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reads and returns action inputs', () => {
    expect(readInputs()).toEqual({
      aikidoCiToken: 'secret-token',
      lcovFilePaths: ['coverage/lcov.info'],
      failOnError: true,
    });
  });

  it('parses multiple lcov file paths from a multiline input', () => {
    core.getInput.mockImplementation((name) => {
      const values = {
        'aikido-ci-token': 'secret-token',
        'lcov-file-paths': 'packages/a/coverage/lcov.info\npackages/b/coverage/lcov.info',
      };
      return values[name] ?? '';
    });

    expect(readInputs()).toEqual({
      aikidoCiToken: 'secret-token',
      lcovFilePaths: ['packages/a/coverage/lcov.info', 'packages/b/coverage/lcov.info'],
      failOnError: true,
    });
  });

  it('parses multiple lcov file paths from a comma-separated input', () => {
    core.getInput.mockImplementation((name) => {
      const values = {
        'aikido-ci-token': 'secret-token',
        'lcov-file-paths': 'packages/a/coverage/lcov.info,packages/b/coverage/lcov.info',
      };
      return values[name] ?? '';
    });

    expect(readInputs()).toEqual({
      aikidoCiToken: 'secret-token',
      lcovFilePaths: ['packages/a/coverage/lcov.info', 'packages/b/coverage/lcov.info'],
      failOnError: true,
    });
  });

  it('parses multiple lcov file paths from a space-separated input', () => {
    core.getInput.mockImplementation((name) => {
      const values = {
        'aikido-ci-token': 'secret-token',
        'lcov-file-paths': 'packages/a/coverage/lcov.info packages/b/coverage/lcov.info',
      };
      return values[name] ?? '';
    });

    expect(readInputs()).toEqual({
      aikidoCiToken: 'secret-token',
      lcovFilePaths: ['packages/a/coverage/lcov.info', 'packages/b/coverage/lcov.info'],
      failOnError: true,
    });
  });

  it('requests required inputs with trimWhitespace', () => {
    readInputs();

    expect(core.getInput).toHaveBeenCalledWith('aikido-ci-token', {
      required: true,
      trimWhitespace: true,
    });
    expect(core.getInput).toHaveBeenCalledWith('lcov-file-paths', {
      required: true,
      trimWhitespace: true,
    });
    expect(core.getBooleanInput).toHaveBeenCalledWith('fail-on-error');
  });
});
