import { jest } from '@jest/globals';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mockInfo = jest.fn();
const mockDebug = jest.fn();
const mockSetFailed = jest.fn();
const mockWarning = jest.fn();
const mockGetInput = jest.fn();
const mockGetBooleanInput = jest.fn();
const mockPost = jest.fn();
const mockHttpClient = jest.fn();
const mockGetIDToken = jest.fn();
const mockSetSecret = jest.fn();
const originalGitHubWorkspace = process.env.GITHUB_WORKSPACE;

jest.unstable_mockModule('@actions/core', () => ({
  info: mockInfo,
  debug: mockDebug,
  setFailed: mockSetFailed,
  warning: mockWarning,
  getInput: mockGetInput,
  getBooleanInput: mockGetBooleanInput,
  getIDToken: mockGetIDToken,
  setSecret: mockSetSecret,
}));

jest.unstable_mockModule('@actions/http-client', () => ({
  HttpClient: mockHttpClient,
  HttpCodes: {
    OK: 200,
  },
}));

const { run } = await import('../../src/main.js');

function mockResponse(statusCode, rawBody = '') {
  return {
    message: { statusCode },
    readBody: jest.fn().mockResolvedValue(rawBody),
  };
}

/**
 * End-to-end regression for the PR SHA mismatch:
 * Aikido's open PR check keys on related_commit_sha = pull_request.head.sha.
 * GitHub sets GITHUB_SHA to a temporary merge commit on pull_request events.
 * If the action uploads that merge SHA, coverage never attaches to the check.
 */
describe('regression: PR coverage attaches via head SHA', () => {
  let tmpDir;

  // Distinct SHAs so a wrong pick is obvious.
  const githubMergeSha = '1111111111111111111111111111111111111111';
  const relatedCommitSha = '2222222222222222222222222222222222222222'; // PR check head
  const lcovContent = 'TN:\nSF:src/app.js\nDA:1,5\nend_of_record\n';

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-pr-sha-'));

    process.env.GITHUB_REPOSITORY = 'org/repo';
    process.env.GITHUB_SHA = githubMergeSha;
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    process.env.GITHUB_HEAD_REF = 'feature-branch';
    process.env.GITHUB_WORKSPACE = tmpDir;
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.DEVELOPMENT;

    mockInfo.mockClear();
    mockDebug.mockClear();
    mockSetFailed.mockClear();
    mockWarning.mockClear();
    mockGetInput.mockClear();
    mockGetBooleanInput.mockClear();
    mockPost.mockClear();
    mockHttpClient.mockClear();
    mockGetIDToken.mockClear();
    mockSetSecret.mockClear();

    mockGetInput.mockImplementation((name) => {
      if (name === 'file-paths') {
        return 'lcov.info';
      }
      if (name === 'region') {
        return 'eu';
      }
      return '';
    });
    mockGetBooleanInput.mockReturnValue(true);
    mockHttpClient.mockImplementation(() => ({
      post: mockPost,
    }));
    mockPost.mockResolvedValue(mockResponse(200, JSON.stringify({ success: true })));
    mockGetIDToken.mockResolvedValue('oidc-jwt');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    if (originalGitHubWorkspace === undefined) {
      delete process.env.GITHUB_WORKSPACE;
    } else {
      process.env.GITHUB_WORKSPACE = originalGitHubWorkspace;
    }
  });

  it('sends commit_sha equal to the PR check head, not GITHUB_SHA', async () => {
    const eventPath = path.join(tmpDir, 'github-event.json');
    await fs.writeFile(
      eventPath,
      JSON.stringify({
        pull_request: {
          head: { sha: relatedCommitSha },
        },
      }),
    );
    process.env.GITHUB_EVENT_PATH = eventPath;

    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await fs.mkdir('.git', { recursive: true });
      await fs.mkdir('src', { recursive: true });
      await fs.writeFile('src/app.js', 'a\nb\n');
      await fs.writeFile('lcov.info', lcovContent);

      await run();
    } finally {
      process.chdir(previousCwd);
    }

    expect(mockSetFailed).not.toHaveBeenCalled();
    expect(mockPost).toHaveBeenCalledTimes(1);

    const uploaded = JSON.parse(mockPost.mock.calls[0][1]);

    // Snapshot must be stored under the same SHA the PR check queries.
    expect(uploaded.commit_sha).toBe(relatedCommitSha);

    // The merge commit from GITHUB_SHA must never be used on pull_request.
    expect(uploaded.commit_sha).not.toBe(githubMergeSha);
    expect(uploaded.commit_sha).not.toBe(process.env.GITHUB_SHA);
  });
});
