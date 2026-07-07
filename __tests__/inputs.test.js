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
    mockGetBooleanInput.mockImplementation((name) => {
      if (name === 'use-oidc') return false;
      if (name === 'fail-on-error') return true;
      return false;
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('reads and returns action inputs', () => {
    expect(readInputs()).toEqual({
      useOidc: false,
      aikidoCiToken: 'secret-token',
      lcovFilePaths: ['coverage/lcov.info'],
      failOnError: true,
    });
  });

  it('reads OIDC mode when use-oidc is true', () => {
    mockGetInput.mockImplementation((name) => {
      const values = {
        'aikido-ci-token': '',
        'lcov-file-paths': 'coverage/lcov.info',
      };
      return values[name] ?? '';
    });
    mockGetBooleanInput.mockImplementation((name) => {
      if (name === 'use-oidc') return true;
      if (name === 'fail-on-error') return true;
      return false;
    });

    expect(readInputs()).toEqual({
      useOidc: true,
      aikidoCiToken: '',
      lcovFilePaths: ['coverage/lcov.info'],
      failOnError: true,
    });
  });

  it('throws when both OIDC and a secret token are provided', () => {
    mockGetBooleanInput.mockImplementation((name) => {
      if (name === 'use-oidc') return true;
      if (name === 'fail-on-error') return true;
      return false;
    });

    expect(() => readInputs()).toThrow(
      "Set either 'use-oidc: true' or 'aikido-ci-token', not both.",
    );
  });

  it('throws when neither OIDC nor a secret token is provided', () => {
    mockGetInput.mockImplementation((name) => {
      const values = {
        'aikido-ci-token': '',
        'lcov-file-paths': 'coverage/lcov.info',
      };
      return values[name] ?? '';
    });

    expect(() => readInputs()).toThrow("Provide 'aikido-ci-token' or set 'use-oidc: true'.");
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
      useOidc: false,
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
      useOidc: false,
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
      useOidc: false,
      aikidoCiToken: 'secret-token',
      lcovFilePaths: ['packages/a/coverage/lcov.info', 'packages/b/coverage/lcov.info'],
      failOnError: true,
    });
  });

  it('requests inputs with trimWhitespace and optional token', () => {
    readInputs();

    expect(mockGetInput).toHaveBeenCalledWith('aikido-ci-token', {
      required: false,
      trimWhitespace: true,
    });
    expect(mockGetInput).toHaveBeenCalledWith('lcov-file-paths', {
      required: true,
      trimWhitespace: true,
    });
    expect(mockGetBooleanInput).toHaveBeenCalledWith('use-oidc');
    expect(mockGetBooleanInput).toHaveBeenCalledWith('fail-on-error');
  });
});
