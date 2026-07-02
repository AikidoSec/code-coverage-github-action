import { jest } from '@jest/globals';

const mockGetInput = jest.fn();
const mockGetBooleanInput = jest.fn();

jest.unstable_mockModule('@actions/core', () => ({
  getInput: mockGetInput,
  getBooleanInput: mockGetBooleanInput,
}));

const { readInputs } = await import('../src/inputs.js');

describe('readInputs', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      GITHUB_REPOSITORY: 'AikidoSec/code-coverage-github-action',
      GITHUB_SHA: 'abc123def456',
      GITHUB_REF_NAME: 'main',
    };

    mockGetInput.mockImplementation((name) => {
      const values = {
        'aikido-ci-token': 'secret-token',
        'lcov-file-paths': 'coverage/lcov.info',
      };
      return values[name] ?? '';
    });
    mockGetBooleanInput.mockReturnValue(true);
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
    mockGetInput.mockImplementation((name) => {
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
    mockGetInput.mockImplementation((name) => {
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
    mockGetInput.mockImplementation((name) => {
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

    expect(mockGetInput).toHaveBeenCalledWith('aikido-ci-token', {
      required: true,
      trimWhitespace: true,
    });
    expect(mockGetInput).toHaveBeenCalledWith('lcov-file-paths', {
      required: true,
      trimWhitespace: true,
    });
    expect(mockGetBooleanInput).toHaveBeenCalledWith('fail-on-error');
  });
});
