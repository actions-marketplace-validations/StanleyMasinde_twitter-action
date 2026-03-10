import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildActionPaths,
  buildTwitterEnvironment,
  INSTALLER_URL,
  parseInputs,
  registerSecrets,
  renderTwitterConfig,
  runAction,
  type ActionServices,
  type CommandOptions,
  type CommandResult,
  type InputOptions,
} from '../src/action.js';

function createMockServices(
  overrides: Partial<ActionServices> = {},
): ActionServices & {
  addPathCalls: string[];
  execCalls: Array<{ command: string; args: string[]; options?: CommandOptions }>;
  writes: Array<{ filePath: string; content: string }>;
  copies: Array<{ fromPath: string; toPath: string }>;
  registeredSecrets: string[];
} {
  const addPathCalls: string[] = [];
  const execCalls: Array<{ command: string; args: string[]; options?: CommandOptions }> = [];
  const writes: Array<{ filePath: string; content: string }> = [];
  const copies: Array<{ fromPath: string; toPath: string }> = [];
  const registeredSecrets: string[] = [];

  const inputs = {
    body: 'Ship it',
    twitter_version: 'latest',
    consumer_key: 'consumer-key',
    consumer_secret: 'consumer-secret',
    access_token: 'access-token',
    access_secret: 'access-secret',
    bearer_token: 'bearer-token',
  };

  const services: ActionServices = {
    env: {
      GITHUB_PATH: '/tmp/github-path',
      PATH: '/usr/bin',
    },
    platform: 'linux',
    tempRoot: '/tmp/runner',
    getInput: vi.fn((name: string, options?: InputOptions) => {
      const value = inputs[name as keyof typeof inputs] ?? '';
      if (options?.required && !value) {
        throw new Error(`Input required and not supplied: ${name}`);
      }
      return value;
    }),
    setSecret: vi.fn((secret: string) => {
      registeredSecrets.push(secret);
    }),
    addPath: vi.fn((inputPath: string) => {
      addPathCalls.push(inputPath);
    }),
    info: vi.fn(),
    warning: vi.fn(),
    exec: vi.fn(async (command: string, args: string[], options?: CommandOptions) => {
      execCalls.push({ command, args, options });
      return { stdout: '', stderr: '', exitCode: 0 };
    }),
    fetchText: vi.fn(async () => '#!/usr/bin/env sh\n'),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (filePath: string, content: string) => {
      writes.push({ filePath, content });
    }),
    copyFile: vi.fn(async (fromPath: string, toPath: string) => {
      copies.push({ fromPath, toPath });
    }),
    fileExists: vi.fn(async () => false),
    ...overrides,
  };

  return Object.assign(services, {
    addPathCalls,
    execCalls,
    writes,
    copies,
    registeredSecrets,
  });
}

describe('parseInputs', () => {
  it('reads required action inputs', () => {
    const getInput = vi.fn((name: string) => {
      const inputs: Record<string, string> = {
        body: 'hello world',
        consumer_key: 'consumer-key',
        consumer_secret: 'consumer-secret',
        access_token: 'access-token',
        access_secret: 'access-secret',
        bearer_token: 'bearer-token',
      };

      return inputs[name] ?? '';
    });

    const inputs = parseInputs(getInput);

    expect(inputs.twitterVersion).toBe('latest');
    expect(inputs.body).toBe('hello world');
    expect(inputs.credentials.consumerKey).toBe('consumer-key');
  });

  it('fails when the body is blank', () => {
    expect(() =>
      parseInputs((name: string) => (name === 'body' ? '   ' : 'token')),
    ).toThrow('Input "body" must not be empty.');
  });
});

describe('registerSecrets', () => {
  it('masks every twitter credential', () => {
    const setSecret = vi.fn();

    registerSecrets(setSecret, {
      consumerKey: 'consumer-key',
      consumerSecret: 'consumer-secret',
      accessToken: 'access-token',
      accessSecret: 'access-secret',
      bearerToken: 'bearer-token',
    });

    expect(setSecret).toHaveBeenCalledTimes(5);
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
  it('injects config locations into the environment', () => {
    const environment = buildTwitterEnvironment(
      { PATH: '/usr/bin' },
      '/tmp/runner/twitter-action/home',
    );

    expect(environment.PATH).toBe('/usr/bin');
    expect(environment.HOME).toBe('/tmp/runner/twitter-action/home');
    expect(environment.APPDATA).toBe('/tmp/runner/twitter-action/home/AppData/Roaming');
  });

  it('preserves APPDATA when it is already provided', () => {
    const environment = buildTwitterEnvironment(
      { APPDATA: 'C:\\Users\\runneradmin\\AppData\\Roaming' },
      'C:\\temp\\twitter-action\\home',
    );

    expect(environment.APPDATA).toBe('C:\\Users\\runneradmin\\AppData\\Roaming');
  });
});

describe('buildActionPaths', () => {
  it('uses the linux xdg config path for the twitter cli config', () => {
    const paths = buildActionPaths('/tmp/runner', 'linux');

    expect(paths.configPaths).toEqual([
      '/tmp/runner/twitter-action/home/.config/twitter_cli/config.toml',
    ]);
  });

  it('uses the same xdg config path on darwin', () => {
    const paths = buildActionPaths('/tmp/runner', 'darwin');

    expect(paths.configPaths).toEqual([
      '/tmp/runner/twitter-action/home/.config/twitter_cli/config.toml',
    ]);
  });

  it('uses APPDATA on windows for the twitter cli config', () => {
    const paths = buildActionPaths('C:\\temp', 'win32', {
      APPDATA: 'C:\\Users\\runneradmin\\AppData\\Roaming',
    });

    expect(paths.configPaths).toEqual([
      path.join('C:\\Users\\runneradmin\\AppData\\Roaming', 'twitter_cli', 'config.toml'),
    ]);
  });
});

describe('runAction', () => {
  it('installs the CLI, masks secrets, writes config, and sends the tweet', async () => {
    const services = createMockServices();
    services.exec = vi.fn(async (command: string, args: string[], options?: CommandOptions) => {
      services.execCalls.push({ command, args, options });
      const result: CommandResult =
        command === 'bash'
          ? { stdout: 'installed', stderr: '', exitCode: 0 }
          : { stdout: 'Tweet Id: 123', stderr: '', exitCode: 0 };
      return result;
    });

    await runAction(services);

    const paths = buildActionPaths('/tmp/runner', 'linux');
    expect(services.fetchText).toHaveBeenCalledWith(INSTALLER_URL);
    expect(services.registeredSecrets).toEqual([
      'consumer-key',
      'consumer-secret',
      'access-token',
      'access-secret',
      'bearer-token',
    ]);
    expect(services.addPathCalls).toEqual([paths.installDir]);
    expect(services.execCalls[0]).toMatchObject({
      command: 'bash',
      args: ['-s'],
    });
    expect(services.execCalls[1]).toMatchObject({
      command: paths.binaryPath,
      args: ['tweet', '--body', 'Ship it'],
    });
    expect(services.writes).toContainEqual({
      filePath: '/tmp/runner/twitter-action/home/.config/twitter_cli/config.toml',
      content: renderTwitterConfig({
        consumerKey: 'consumer-key',
        consumerSecret: 'consumer-secret',
        accessToken: 'access-token',
        accessSecret: 'access-secret',
        bearerToken: 'bearer-token',
      }),
    });
  });

  it('creates a windows executable alias when the installer leaves only a bare binary', async () => {
    const paths = buildActionPaths('C:\\temp', 'win32', {
      APPDATA: 'C:\\Users\\runneradmin\\AppData\\Roaming',
    });
    const services = createMockServices({
      platform: 'win32',
      tempRoot: 'C:\\temp',
      env: {
        Path: 'C:\\Windows\\System32',
        APPDATA: 'C:\\Users\\runneradmin\\AppData\\Roaming',
      },
      fileExists: vi.fn(async (filePath: string) => filePath === path.join(paths.installDir, 'twitter')),
    });
    services.exec = vi.fn(async (command: string, args: string[], options?: CommandOptions) => {
      services.execCalls.push({ command, args, options });
      return { stdout: '', stderr: '', exitCode: 0 };
    });

    await runAction(services);

    expect(services.copies).toContainEqual({
      fromPath: path.join(paths.installDir, 'twitter'),
      toPath: path.join(paths.installDir, 'twitter.exe'),
    });
    expect(services.writes).toContainEqual({
      filePath: path.join('C:\\Users\\runneradmin\\AppData\\Roaming', 'twitter_cli', 'config.toml'),
      content: renderTwitterConfig({
        consumerKey: 'consumer-key',
        consumerSecret: 'consumer-secret',
        accessToken: 'access-token',
        accessSecret: 'access-secret',
        bearerToken: 'bearer-token',
      }),
    });
    expect(services.addPathCalls).toEqual([paths.installDir]);
    expect(services.execCalls[1]?.command).toBe(path.join(paths.installDir, 'twitter.exe'));
  });
});
