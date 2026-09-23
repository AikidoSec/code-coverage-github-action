import { jest } from '@jest/globals';

const mockGetInput = jest.fn();
const mockGetBooleanInput = jest.fn();
const mockError = jest.fn();

jest.unstable_mockModule('@actions/core', () => ({
  getInput: mockGetInput,
  getBooleanInput: mockGetBooleanInput,
  error: mockError,
}));

const { readInputs } = await import('../src/inputs.js');

const OIDC_URL = 'ACTIONS_ID_TOKEN_REQUEST_URL';
const OIDC_TOKEN = 'ACTIONS_ID_TOKEN_REQUEST_TOKEN';

describe('readInputs', () => {
  beforeEach(() => {
    delete process.env[OIDC_URL];
    delete process.env[OIDC_TOKEN];
    mockError.mockClear();

    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'coverage/lcov.info';
      }
      if (name === 'region') {
        return '';
      }
      return '';
    });
    mockGetBooleanInput.mockReturnValue(true);
  });

  it('reads action inputs', () => {
    expect(readInputs()).toEqual({
      filePaths: ['coverage/lcov.info'],
      failOnError: true,
      region: 'eu',
      aikidoToken: '',
    });
    expect(mockGetInput).toHaveBeenCalledWith('file-paths', {
      required: true,
      trimWhitespace: true,
    });
    expect(mockGetInput).toHaveBeenCalledWith('region', {
      required: false,
      trimWhitespace: true,
    });
    expect(mockGetInput).toHaveBeenCalledWith('aikido-token', {
      required: false,
      trimWhitespace: true,
    });
    expect(mockGetBooleanInput).toHaveBeenCalledWith('fail-on-error');
    expect(mockError).not.toHaveBeenCalled();
  });

  it('reads an explicit region', () => {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'coverage/lcov.info';
      }
      if (name === 'region') {
        return 'us';
      }
      return '';
    });

    expect(readInputs().region).toBe('us');
  });

  it('reads aikido-token when provided', () => {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'coverage/lcov.info';
      }
      if (name === 'aikido-token') {
        return 'static-ci-token';
      }
      return '';
    });

    expect(readInputs().aikidoToken).toBe('static-ci-token');
    expect(mockError).not.toHaveBeenCalled();
  });

  it('errors when both aikido-token and OIDC are configured', () => {
    process.env[OIDC_URL] = 'https://example.actions.githubusercontent.com';
    process.env[OIDC_TOKEN] = 'request-token';

    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'coverage/lcov.info';
      }
      if (name === 'aikido-token') {
        return 'static-ci-token';
      }
      return '';
    });

    expect(() => readInputs()).toThrow(
      'Both aikido-token and OIDC (id-token: write) are configured. Remove one authentication method before continuing.',
    );
  });

  it('does not error when only OIDC env vars are present', () => {
    process.env[OIDC_URL] = 'https://example.actions.githubusercontent.com';
    process.env[OIDC_TOKEN] = 'request-token';

    readInputs();

    expect(mockError).not.toHaveBeenCalled();
  });

  it.each([
    ['newlines', 'packages/a/coverage/lcov.info\npackages/b/coverage/lcov.info'],
    ['commas', 'packages/a/coverage/lcov.info,packages/b/coverage/lcov.info'],
    ['spaces', 'packages/a/coverage/lcov.info packages/b/coverage/lcov.info'],
  ])('splits file paths on %s', (_label, input) => {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return input;
      }
      return '';
    });

    expect(readInputs().filePaths).toEqual([
      'packages/a/coverage/lcov.info',
      'packages/b/coverage/lcov.info',
    ]);
  });
});
