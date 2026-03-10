import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const INSTALLER_URL = 'https://raw.githubusercontent.com/StanleyMasinde/twitter/main/install.sh';
function envKey(name) {
    return `INPUT_${name.toUpperCase()}`;
}
function getRequiredInput(env, name) {
    const value = env[envKey(name)];
    if (!value || value.trim().length === 0) {
        throw new Error(`Missing required input: ${name}`);
    }
    return value;
}
function getOptionalInput(env, name) {
    const value = env[envKey(name)];
    return value && value.trim().length > 0 ? value.trim() : undefined;
}
export function parseInputs(env) {
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
function escapeTomlString(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}
export function renderTwitterConfig(credentials) {
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
export function buildActionPaths(tempRoot, platform) {
    const workspaceDir = path.join(tempRoot, 'twitter-action');
    const homeDir = path.join(workspaceDir, 'home');
    const installDir = path.join(workspaceDir, 'bin');
    const fallbackBinaryPath = path.join(installDir, 'twitter');
    const binaryPath = platform === 'win32' ? path.join(installDir, 'twitter.exe') : fallbackBinaryPath;
    const configPaths = Array.from(new Set([
        path.join(homeDir, '.config', 'twitter_cli', 'config.toml'),
        path.join(homeDir, 'Library', 'Application Support', 'twitter_cli', 'config.toml'),
        path.join(homeDir, 'AppData', 'Roaming', 'twitter_cli', 'config.toml'),
    ]));
    return {
        workspaceDir,
        homeDir,
        installDir,
        configPaths,
        binaryPath,
        fallbackBinaryPath,
    };
}
export function buildTwitterEnvironment(env, installDir, homeDir) {
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
export async function writeTwitterConfig(runtime, configPaths, credentials) {
    const content = renderTwitterConfig(credentials);
    for (const configPath of configPaths) {
        await runtime.mkdir(path.dirname(configPath));
        await runtime.writeFile(configPath, content);
    }
}
async function appendPath(runtime, installDir) {
    runtime.env.PATH = runtime.env.PATH
        ? `${installDir}${path.delimiter}${runtime.env.PATH}`
        : installDir;
    if (runtime.env.GITHUB_PATH) {
        await runtime.appendFile(runtime.env.GITHUB_PATH, `${installDir}${os.EOL}`);
    }
}
function formatCommandError(command, args, exitCode, stdout, stderr) {
    const lines = [`Command failed (${exitCode}): ${command} ${args.join(' ')}`];
    if (stdout.trim()) {
        lines.push(`stdout:\n${stdout.trimEnd()}`);
    }
    if (stderr.trim()) {
        lines.push(`stderr:\n${stderr.trimEnd()}`);
    }
    return lines.join('\n\n');
}
export function createRuntime() {
    return {
        env: process.env,
        platform: process.platform,
        tempRoot: process.env.RUNNER_TEMP ?? os.tmpdir(),
        async fetchText(url) {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
            }
            return response.text();
        },
        exec(command, args, options = {}) {
            return new Promise((resolve, reject) => {
                const child = spawn(command, args, {
                    cwd: options.cwd,
                    env: options.env,
                    stdio: 'pipe',
                });
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (chunk) => {
                    stdout += chunk.toString();
                });
                child.stderr.on('data', (chunk) => {
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
        async mkdir(dirPath) {
            await fs.mkdir(dirPath, { recursive: true });
        },
        async writeFile(filePath, content) {
            await fs.writeFile(filePath, content, 'utf8');
        },
        async appendFile(filePath, content) {
            await fs.appendFile(filePath, content, 'utf8');
        },
        async copyFile(fromPath, toPath) {
            await fs.copyFile(fromPath, toPath);
        },
        async fileExists(filePath) {
            try {
                await fs.access(filePath);
                return true;
            }
            catch {
                return false;
            }
        },
        log(message) {
            console.log(message);
        },
        error(message) {
            console.error(message);
        },
    };
}
export async function installTwitter(runtime, version, installDir, environment) {
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
export async function tweet(runtime, binaryPath, body, environment) {
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
export async function runAction(runtime = createRuntime()) {
    const inputs = parseInputs(runtime.env);
    const paths = buildActionPaths(runtime.tempRoot, runtime.platform);
    await runtime.mkdir(paths.workspaceDir);
    const twitterEnvironment = buildTwitterEnvironment(runtime.env, paths.installDir, paths.homeDir);
    await installTwitter(runtime, inputs.twitterVersion, paths.installDir, twitterEnvironment);
    await appendPath(runtime, paths.installDir);
    await writeTwitterConfig(runtime, paths.configPaths, inputs.credentials);
    await tweet(runtime, paths.binaryPath, inputs.body, twitterEnvironment);
}
//# sourceMappingURL=action.js.map