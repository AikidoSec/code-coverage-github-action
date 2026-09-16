import { jest } from '@jest/globals';

const mockGetInput = jest.fn();
const mockGetBooleanInput = jest.fn();

jest.unstable_mockModule('@actions/core', () => ({
  getInput: mockGetInput,
  getBooleanInput: mockGetBooleanInput,
}));

const { readInputs } = await import('../src/inputs.js');

describe('readInputs', () => {
  beforeEach(() => {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'coverage/lcov.info';
      }
      if (name === 'format') {
        return 'lcov';
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
      format: 'lcov',
    });
    expect(mockGetInput).toHaveBeenCalledWith('file-paths', {
      required: true,
      trimWhitespace: true,
    });
    expect(mockGetInput).toHaveBeenCalledWith('format', {
      required: true,
      trimWhitespace: true,
    });
    expect(mockGetInput).toHaveBeenCalledWith('region', {
      required: false,
      trimWhitespace: true,
    });
    expect(mockGetBooleanInput).toHaveBeenCalledWith('fail-on-error');
  });

  it('reads cobertura format', () => {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'coverage/cobertura.xml';
      }
      if (name === 'format') {
        return 'cobertura';
      }
      return '';
    });

    expect(readInputs()).toEqual({
      filePaths: ['coverage/cobertura.xml'],
      failOnError: true,
      region: 'eu',
      format: 'cobertura',
    });
  });

  it('reads an explicit region', () => {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'coverage/lcov.info';
      }
      if (name === 'format') {
        return 'lcov';
      }
      if (name === 'region') {
        return 'us';
      }
      return '';
    });

    expect(readInputs().region).toBe('us');
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
      if (name === 'format') {
        return 'lcov';
      }
      return '';
    });

    expect(readInputs().filePaths).toEqual([
      'packages/a/coverage/lcov.info',
      'packages/b/coverage/lcov.info',
    ]);
  });

  it('throws when format is invalid', () => {
    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'coverage/lcov.info';
      }
      if (name === 'format') {
        return 'jacoco';
      }
      return '';
    });

    expect(() => readInputs()).toThrow(/Invalid format/);
  });
});
