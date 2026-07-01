/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js'],
  verbose: true,
};
