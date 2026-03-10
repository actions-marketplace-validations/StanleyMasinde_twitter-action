import { spawn } from 'node:child_process';
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

export interface CommandOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ActionRuntime {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  tempRoot: string;
  fetchText(url: string): Promise<string>;
  exec(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;
  mkdir(dirPath: string): Promise<void>;
  writeFile(filePath: string, content: string): Promise<void>;
  appendFile(filePath: string, content: string): Promise<void>;
  copyFile(fromPath: string, toPath: string): Promise<void>;
  fileExists(filePath: string): Promise<boolean>;
  log(message: string): void;
  error(message: string): void;
}

function envKey(name: string): string {
  return `INPUT_${name.toUpperCase()}`;
}

function getRequiredInput(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[envKey(name)];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required input: ${name}`);
  }

  return value;
}

function getOptionalInput(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[envKey(name)];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseInputs(env: NodeJS.ProcessEnv): ActionInputs {
  const body = getRequiredInput(env, 'body');
  if (body.trim().length === 0) {
    throw new Error('Input "body" must not be empty.');
  }

  return {
    body,
    twitterVersion: getOptionalInput(env, 'twitter_version') ?? 'latest',
    credentials: {
      consumerKey: getRequiredInput(env, 'consumer_key').trim(),
      consumerSecret: getRequiredInput(env, 'consumer_secret').trim(),
      accessToken: getRequiredInput(env, 'access_token').trim(),
      accessSecret: getRequiredInput(env, 'access_secret').trim(),
      bearerToken: getRequiredInput(env, 'bearer_token').trim(),
    },
  };
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

export function buildActionPaths(tempRoot: string, platform: NodeJS.Platform): ActionPaths {
  const workspaceDir = path.join(tempRoot, 'twitter-action');
  const homeDir = path.join(workspaceDir, 'home');
  const installDir = path.join(workspaceDir, 'bin');
  const fallbackBinaryPath = path.join(installDir, 'twitter');
  const binaryPath =
    platform === 'win32' ? path.join(installDir, 'twitter.exe') : fallbackBinaryPath;

  const configPaths = Array.from(
    new Set([
      path.join(homeDir, '.config', 'twitter_cli', 'config.toml'),
      path.join(homeDir, 'Library', 'Application Support', 'twitter_cli', 'config.toml'),
      path.join(homeDir, 'AppData', 'Roaming', 'twitter_cli', 'config.toml'),
    ]),
  );

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
  installDir: string,
  homeDir: string,
): NodeJS.ProcessEnv {
  const appDataDir = path.join(homeDir, 'AppData', 'Roaming');
  const xdgConfigDir = path.join(homeDir, '.config');
  const existingPath = env.PATH ?? '';
  const nextPath = existingPath ? `${installDir}${path.delimiter}${existingPath}` : installDir;

  return {
    ...env,
    PATH: nextPath,
    HOME: homeDir,
    USERPROFILE: homeDir,
    APPDATA: appDataDir,
    XDG_CONFIG_HOME: xdgConfigDir,
  };
}

export async function writeTwitterConfig(
  runtime: ActionRuntime,
  configPaths: string[],
  credentials: TwitterCredentials,
): Promise<void> {
  const content = renderTwitterConfig(credentials);

  for (const configPath of configPaths) {
    await runtime.mkdir(path.dirname(configPath));
    await runtime.writeFile(configPath, content);
  }
}

async function appendPath(runtime: ActionRuntime, installDir: string): Promise<void> {
  runtime.env.PATH = runtime.env.PATH
    ? `${installDir}${path.delimiter}${runtime.env.PATH}`
    : installDir;

  if (runtime.env.GITHUB_PATH) {
    await runtime.appendFile(runtime.env.GITHUB_PATH, `${installDir}${os.EOL}`);
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

export function createRuntime(): ActionRuntime {
  return {
    env: process.env,
    platform: process.platform,
    tempRoot: process.env.RUNNER_TEMP ?? os.tmpdir(),
    async fetchText(url: string): Promise<string> {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
      }

      return response.text();
    },
    exec(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
      return new Promise<CommandResult>((resolve, reject) => {
        const child = spawn(command, args, {
          cwd: options.cwd,
          env: options.env,
          stdio: 'pipe',
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        child.stderr.on('data', (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        child.on('error', (error) => {
          reject(error);
        });

        child.on('close', (code) => {
          const exitCode = code ?? 1;
          if (exitCode !== 0) {
            reject(new Error(formatCommandError(command, args, exitCode, stdout, stderr)));
            return;
          }

          resolve({ stdout, stderr, exitCode });
        });

        if (options.input) {
          child.stdin.write(options.input);
        }
        child.stdin.end();
      });
    },
    async mkdir(dirPath: string): Promise<void> {
      await fs.mkdir(dirPath, { recursive: true });
    },
    async writeFile(filePath: string, content: string): Promise<void> {
      await fs.writeFile(filePath, content, 'utf8');
    },
    async appendFile(filePath: string, content: string): Promise<void> {
      await fs.appendFile(filePath, content, 'utf8');
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
    log(message: string): void {
      console.log(message);
    },
    error(message: string): void {
      console.error(message);
    },
  };
}

export async function installTwitter(
  runtime: ActionRuntime,
  version: string,
  installDir: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await runtime.mkdir(installDir);
  const installerScript = await runtime.fetchText(INSTALLER_URL);
  const installerArgs = version === 'latest' ? ['-s'] : ['-s', version];
  const result = await runtime.exec('bash', installerArgs, {
    env: {
      ...environment,
      TWITTER_INSTALL: installDir,
    },
    input: installerScript,
  });

  if (result.stdout.trim()) {
    runtime.log(result.stdout.trimEnd());
  }
  if (result.stderr.trim()) {
    runtime.error(result.stderr.trimEnd());
  }

  if (runtime.platform === 'win32') {
    const bareBinaryPath = path.join(installDir, 'twitter');
    const executablePath = path.join(installDir, 'twitter.exe');
    const hasBareBinary = await runtime.fileExists(bareBinaryPath);
    const hasExecutableBinary = await runtime.fileExists(executablePath);

    if (hasBareBinary && !hasExecutableBinary) {
      await runtime.copyFile(bareBinaryPath, executablePath);
    }
  }
}

export async function tweet(
  runtime: ActionRuntime,
  binaryPath: string,
  body: string,
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const result = await runtime.exec(binaryPath, ['tweet', '--body', body], {
    env: environment,
  });

  if (result.stdout.trim()) {
    runtime.log(result.stdout.trimEnd());
  }
  if (result.stderr.trim()) {
    runtime.error(result.stderr.trimEnd());
  }
}

export async function runAction(runtime: ActionRuntime = createRuntime()): Promise<void> {
  const inputs = parseInputs(runtime.env);
  const paths = buildActionPaths(runtime.tempRoot, runtime.platform);

  await runtime.mkdir(paths.workspaceDir);

  const twitterEnvironment = buildTwitterEnvironment(runtime.env, paths.installDir, paths.homeDir);

  await installTwitter(runtime, inputs.twitterVersion, paths.installDir, twitterEnvironment);
  await appendPath(runtime, paths.installDir);
  await writeTwitterConfig(runtime, paths.configPaths, inputs.credentials);
  await tweet(runtime, paths.binaryPath, inputs.body, twitterEnvironment);
}
