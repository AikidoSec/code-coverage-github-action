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
    mockGetInput.mockReturnValue('coverage/lcov.info');
    mockGetBooleanInput.mockReturnValue(true);
  });

  it('reads action inputs', () => {
    expect(readInputs()).toEqual({
      lcovFilePaths: ['coverage/lcov.info'],
      failOnError: true,
    });
    expect(mockGetInput).toHaveBeenCalledWith('lcov-file-paths', {
      required: true,
      trimWhitespace: true,
    });
    expect(mockGetBooleanInput).toHaveBeenCalledWith('fail-on-error');
  });

  it.each([
    ['newlines', 'packages/a/coverage/lcov.info\npackages/b/coverage/lcov.info'],
    ['commas', 'packages/a/coverage/lcov.info,packages/b/coverage/lcov.info'],
    ['spaces', 'packages/a/coverage/lcov.info packages/b/coverage/lcov.info'],
  ])('splits lcov paths on %s', (_label, input) => {
    mockGetInput.mockReturnValue(input);

    expect(readInputs().lcovFilePaths).toEqual([
      'packages/a/coverage/lcov.info',
      'packages/b/coverage/lcov.info',
    ]);
  });
});
