import * as core from '@actions/core';
import { getExecOutput } from '@actions/exec';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const INSTALLER_URL =
  'https://raw.githubusercontent.com/StanleyMasinde/twitter/main/install.sh';

export interface TwitterCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessSecret: string;
  bearerToken: string;
}

export interface ActionInputs {
  body: string;
  twitterVersion: string;
  credentials: TwitterCredentials;
}

export interface ActionPaths {
  workspaceDir: string;
  installDir: string;
  homeDir: string;
  configPaths: string[];
  binaryPath: string;
  fallbackBinaryPath: string;
}

export interface InputOptions {
  required?: boolean;
  trimWhitespace?: boolean;
}

export interface CommandOptions {
  env?: NodeJS.ProcessEnv;
  input?: string | Buffer;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ActionServices {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  tempRoot: string;
  getInput(name: string, options?: InputOptions): string;
  setSecret(secret: string): void;
  addPath(inputPath: string): void;
  info(message: string): void;
  warning(message: string): void;
  exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
  fetchText(url: string): Promise<string>;
  mkdir(dirPath: string): Promise<void>;
  writeFile(filePath: string, content: string): Promise<void>;
  copyFile(fromPath: string, toPath: string): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
}

export function parseInputs(
  getInput: ActionServices['getInput'],
): ActionInputs {
  const body = getInput('body', { required: true, trimWhitespace: false });
  if (body.trim().length === 0) {
    throw new Error('Input "body" must not be empty.');
  }

  return {
    body,
    twitterVersion: getInput('twitter_version') || 'latest',
    credentials: {
      consumerKey: getInput('consumer_key', { required: true }),
      consumerSecret: getInput('consumer_secret', { required: true }),
      accessToken: getInput('access_token', { required: true }),
      accessSecret: getInput('access_secret', { required: true }),
      bearerToken: getInput('bearer_token', { required: true }),
    },
  };
}

export function registerSecrets(
  setSecret: ActionServices['setSecret'],
  credentials: TwitterCredentials,
): void {
  setSecret(credentials.consumerKey);
  setSecret(credentials.consumerSecret);
  setSecret(credentials.accessToken);
  setSecret(credentials.accessSecret);
  setSecret(credentials.bearerToken);
}

function escapeTomlString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

export function renderTwitterConfig(credentials: TwitterCredentials): string {
  return [
    'current_account = 0',
    '',
    '[[accounts]]',
    `consumer_key = "${escapeTomlString(credentials.consumerKey)}"`,
    `consumer_secret = "${escapeTomlString(credentials.consumerSecret)}"`,
    `access_token = "${escapeTomlString(credentials.accessToken)}"`,
    `access_secret = "${escapeTomlString(credentials.accessSecret)}"`,
    `bearer_token = "${escapeTomlString(credentials.bearerToken)}"`,
    '',
  ].join('\n');
}

export function buildActionPaths(
  tempRoot: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = {},
): ActionPaths {
  const workspaceDir = path.join(tempRoot, 'twitter-action');
  const homeDir = path.join(workspaceDir, 'home');
  const installDir = path.join(workspaceDir, 'bin');
  const fallbackBinaryPath = path.join(installDir, 'twitter');
  const binaryPath =
    platform === 'win32' ? path.join(installDir, 'twitter.exe') : fallbackBinaryPath;
  const windowsConfigRoot = env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');

  const configPaths =
    platform === 'win32'
        ? [path.join(windowsConfigRoot, 'twitter_cli', 'config.toml')]
        : [path.join(homeDir, '.config', 'twitter_cli', 'config.toml')];

  return {
    workspaceDir,
    homeDir,
    installDir,
    configPaths,
    binaryPath,
    fallbackBinaryPath,
  };
}

export function buildTwitterEnvironment(
  env: NodeJS.ProcessEnv,
  homeDir: string,
): NodeJS.ProcessEnv {
  const appData = env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');

  return {
    ...env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: appData,
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  };
}

export async function writeTwitterConfig(
  services: Pick<ActionServices, 'mkdir' | 'writeFile'>,
  configPaths: string[],
  credentials: TwitterCredentials,
): Promise<void> {
  const content = renderTwitterConfig(credentials);

  for (const configPath of configPaths) {
    await services.mkdir(path.dirname(configPath));
    await services.writeFile(configPath, content);
  }
}

function formatCommandError(
  command: string,
  args: string[],
  exitCode: number,
  stdout: string,
  stderr: string,
): string {
  const lines = [`Command failed (${exitCode}): ${command} ${args.join(' ')}`];
  if (stdout.trim()) {
    lines.push(`stdout:\n${stdout.trimEnd()}`);
  }
  if (stderr.trim()) {
    lines.push(`stderr:\n${stderr.trimEnd()}`);
  }

  return lines.join('\n\n');
}

function toExecEnvironment(
  env: NodeJS.ProcessEnv | undefined,
): { [key: string]: string } | undefined {
  if (!env) {
    return undefined;
  }

  const nextEnv: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      nextEnv[key] = value;
    }
  }

  return nextEnv;
}

function toExecInput(input: string | Buffer | undefined): Buffer | undefined {
  if (input === undefined) {
    return undefined;
  }

  return typeof input === 'string' ? Buffer.from(input) : input;
}

export async function runCommand(
  services: Pick<ActionServices, 'exec' | 'info' | 'warning'>,
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<void> {
  const result = await services.exec(command, args, options);

  if (result.stdout.trim()) {
    services.info(result.stdout.trimEnd());
  }
  if (result.stderr.trim()) {
    services.warning(result.stderr.trimEnd());
  }
  if (result.exitCode !== 0) {
    throw new Error(formatCommandError(command, args, result.exitCode, result.stdout, result.stderr));
  }
}

export function createServices(): ActionServices {
  return {
    env: process.env,
    platform: process.platform,
    tempRoot: process.env.RUNNER_TEMP ?? os.tmpdir(),
    getInput: core.getInput,
    setSecret: core.setSecret,
    addPath: core.addPath,
    info: core.info,
    warning: core.warning,
    async exec(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
      const result = await getExecOutput(command, args, {
        env: toExecEnvironment(options.env),
        input: toExecInput(options.input),
        ignoreReturnCode: true,
        silent: true,
      });

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
    async fetchText(url: string): Promise<string> {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }

      return response.text();
    },
    async mkdir(dirPath: string): Promise<void> {
      await fs.mkdir(dirPath, { recursive: true });
    },
    async writeFile(filePath: string, content: string): Promise<void> {
      await fs.writeFile(filePath, content, 'utf8');
    },
    async copyFile(fromPath: string, toPath: string): Promise<void> {
      await fs.copyFile(fromPath, toPath);
    },
    async fileExists(filePath: string): Promise<boolean> {
      try {
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export async function installTwitter(
  services: Pick<ActionServices, 'mkdir' | 'fetchText' | 'exec' | 'info' | 'warning' | 'copyFile' | 'fileExists' | 'platform'>,
  version: string,
  installDir: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await services.mkdir(installDir);
  const installerScript = await services.fetchText(INSTALLER_URL);
  const installerArgs = version === 'latest' ? ['-s'] : ['-s', version];

  await runCommand(services, 'bash', installerArgs, {
    env: {
      ...environment,
      TWITTER_INSTALL: installDir,
    },
    input: Buffer.from(installerScript),
  });

  if (services.platform === 'win32') {
    const bareBinaryPath = path.join(installDir, 'twitter');
    const executablePath = path.join(installDir, 'twitter.exe');
    const hasBareBinary = await services.fileExists(bareBinaryPath);
    const hasExecutableBinary = await services.fileExists(executablePath);

    if (hasBareBinary && !hasExecutableBinary) {
      await services.copyFile(bareBinaryPath, executablePath);
    }
  }
}

export async function tweet(
  services: Pick<ActionServices, 'exec' | 'info' | 'warning'>,
  binaryPath: string,
  body: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await runCommand(services, binaryPath, ['tweet', '--body', body], {
    env: environment,
  });
}

export async function runAction(services: ActionServices = createServices()): Promise<void> {
  const inputs = parseInputs(services.getInput);
  registerSecrets(services.setSecret, inputs.credentials);

  const paths = buildActionPaths(services.tempRoot, services.platform, services.env);
  await services.mkdir(paths.workspaceDir);

  await installTwitter(services, inputs.twitterVersion, paths.installDir, services.env);
  services.addPath(paths.installDir);

  const twitterEnvironment = buildTwitterEnvironment(services.env, paths.homeDir);
  await writeTwitterConfig(services, paths.configPaths, inputs.credentials);
  await tweet(services, paths.binaryPath, inputs.body, twitterEnvironment);
}
