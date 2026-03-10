import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildActionPaths,
  buildTwitterEnvironment,
  INSTALLER_URL,
  parseInputs,
  renderTwitterConfig,
  runAction,
  type ActionRuntime,
  type CommandOptions,
  type CommandResult,
} from '../src/action.js';

function createMockRuntime(
  overrides: Partial<ActionRuntime> = {},
): ActionRuntime & {
  execCalls: Array<{ command: string; args: string[]; options?: CommandOptions }>;
  writes: Array<{ filePath: string; content: string }>;
  appends: Array<{ filePath: string; content: string }>;
  copies: Array<{ fromPath: string; toPath: string }>;
} {
  const execCalls: Array<{ command: string; args: string[]; options?: CommandOptions }> = [];
  const writes: Array<{ filePath: string; content: string }> = [];
  const appends: Array<{ filePath: string; content: string }> = [];
  const copies: Array<{ fromPath: string; toPath: string }> = [];

  const runtime: ActionRuntime = {
    env: {
      INPUT_BODY: 'Ship it',
      INPUT_TWITTER_VERSION: 'latest',
      INPUT_CONSUMER_KEY: 'consumer-key',
      INPUT_CONSUMER_SECRET: 'consumer-secret',
      INPUT_ACCESS_TOKEN: 'access-token',
      INPUT_ACCESS_SECRET: 'access-secret',
      INPUT_BEARER_TOKEN: 'bearer-token',
      GITHUB_PATH: '/tmp/github-path',
      PATH: '/usr/bin',
    },
    platform: 'linux',
    tempRoot: '/tmp/runner',
    fetchText: vi.fn(async () => '#!/usr/bin/env sh\n'),
    exec: vi.fn(async (command: string, args: string[], options?: CommandOptions) => {
      execCalls.push({ command, args, options });
      return { stdout: '', stderr: '', exitCode: 0 };
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (filePath: string, content: string) => {
      writes.push({ filePath, content });
    }),
    appendFile: vi.fn(async (filePath: string, content: string) => {
      appends.push({ filePath, content });
    }),
    copyFile: vi.fn(async (fromPath: string, toPath: string) => {
      copies.push({ fromPath, toPath });
    }),
    fileExists: vi.fn(async () => false),
    log: vi.fn(),
    error: vi.fn(),
    ...overrides,
  };

  return Object.assign(runtime, {
    execCalls,
    writes,
    appends,
    copies,
  });
}

describe('parseInputs', () => {
  it('reads required action inputs', () => {
    const inputs = parseInputs({
      INPUT_BODY: 'hello world',
      INPUT_CONSUMER_KEY: 'consumer-key',
      INPUT_CONSUMER_SECRET: 'consumer-secret',
      INPUT_ACCESS_TOKEN: 'access-token',
      INPUT_ACCESS_SECRET: 'access-secret',
      INPUT_BEARER_TOKEN: 'bearer-token',
    });

    expect(inputs.twitterVersion).toBe('latest');
    expect(inputs.body).toBe('hello world');
    expect(inputs.credentials.consumerKey).toBe('consumer-key');
  });

  it('fails when a required input is missing', () => {
    expect(() =>
      parseInputs({
        INPUT_BODY: 'hello world',
      }),
    ).toThrow('Missing required input: consumer_key');
  });
});

describe('renderTwitterConfig', () => {
  it('renders a valid single-account TOML config', () => {
    const config = renderTwitterConfig({
      consumerKey: 'consumer-"key"',
      consumerSecret: 'consumer-secret',
      accessToken: 'access-token',
      accessSecret: 'access-secret',
      bearerToken: 'bearer-token',
    });

    expect(config).toContain('current_account = 0');
    expect(config).toContain('[[accounts]]');
    expect(config).toContain('consumer_key = "consumer-\\"key\\""');
  });
});

describe('buildTwitterEnvironment', () => {
  it('injects install and config locations into the environment', () => {
    const environment = buildTwitterEnvironment(
      { PATH: '/usr/bin' },
      '/tmp/runner/twitter-action/bin',
      '/tmp/runner/twitter-action/home',
    );

    expect(environment.PATH).toBe('/tmp/runner/twitter-action/bin:/usr/bin');
    expect(environment.HOME).toBe('/tmp/runner/twitter-action/home');
    expect(environment.APPDATA).toBe('/tmp/runner/twitter-action/home/AppData/Roaming');
  });
});

describe('runAction', () => {
  it('installs the CLI, writes config files, and sends the tweet', async () => {
    const runtime = createMockRuntime();
    runtime.exec = vi.fn(async (command: string, args: string[], options?: CommandOptions) => {
      runtime.execCalls.push({ command, args, options });
      const result: CommandResult =
        command === 'bash'
          ? { stdout: 'installed', stderr: '', exitCode: 0 }
          : { stdout: 'Tweet Id: 123', stderr: '', exitCode: 0 };
      return result;
    });

    await runAction(runtime);

    const paths = buildActionPaths('/tmp/runner', 'linux');
    expect(runtime.fetchText).toHaveBeenCalledWith(INSTALLER_URL);
    expect(runtime.execCalls[0]).toMatchObject({
      command: 'bash',
      args: ['-s'],
    });
    expect(runtime.execCalls[1]).toMatchObject({
      command: paths.binaryPath,
      args: ['tweet', '--body', 'Ship it'],
    });
    expect(runtime.appends).toContainEqual({
      filePath: '/tmp/github-path',
      content: `${paths.installDir}\n`,
    });
    expect(runtime.writes.some(({ filePath }) => filePath.endsWith('twitter_cli/config.toml'))).toBe(
      true,
    );
  });

  it('creates a windows executable alias when the installer leaves only a bare binary', async () => {
    const paths = buildActionPaths('C:\\temp', 'win32');
    const runtime = createMockRuntime({
      platform: 'win32',
      tempRoot: 'C:\\temp',
      env: {
        INPUT_BODY: 'Ship it',
        INPUT_CONSUMER_KEY: 'consumer-key',
        INPUT_CONSUMER_SECRET: 'consumer-secret',
        INPUT_ACCESS_TOKEN: 'access-token',
        INPUT_ACCESS_SECRET: 'access-secret',
        INPUT_BEARER_TOKEN: 'bearer-token',
        PATH: 'C:\\Windows\\System32',
      },
      fileExists: vi.fn(async (filePath: string) => filePath === path.join(paths.installDir, 'twitter')),
    });
    runtime.exec = vi.fn(async (command: string, args: string[], options?: CommandOptions) => {
      runtime.execCalls.push({ command, args, options });
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await runAction(runtime);

    expect(runtime.copies).toContainEqual({
      fromPath: path.join(paths.installDir, 'twitter'),
      toPath: path.join(paths.installDir, 'twitter.exe'),
    });
    expect(runtime.execCalls[1]?.command).toBe(path.join(paths.installDir, 'twitter.exe'));
  });
});
