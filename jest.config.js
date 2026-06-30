/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.js'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.js'],
  verbose: true,
};
