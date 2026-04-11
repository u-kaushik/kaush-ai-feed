#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const mode = (process.argv[2] || 'full').toLowerCase();
const root = process.cwd();

const home = process.env.HOME;
const basePath = process.env.PATH || '';
const extraPaths = [
  home ? join(home, 'bin') : null,
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
].filter(Boolean);
process.env.PATH = [...new Set([...extraPaths, ...basePath.split(':').filter(Boolean)])].join(':');

const logDir = join(root, '.state', 'logs');
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, 'scheduler.log');

function log(line) {
  const stamp = new Date().toISOString();
  const text = `[${stamp}] ${line}`;
  console.log(text);
  appendFileSync(logFile, `${text}\n`);
}

function run(command, args) {
  log(`Running: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} exited with code ${result.status ?? 'unknown'}`);
  }
}

try {
  if (mode === 'pm' || mode === 'refresh') {
    log('Starting PM refresh');
    run('pnpm', ['digest:update']);
    log('Completed PM refresh');
    run('node', ['scripts/publish-refresh.mjs', 'refresh']);
    log('Published PM refresh');
  } else {
    log('Starting AM full digest run');
    run('pnpm', ['digest:run']);
    log('Completed AM full digest run');
    run('node', ['scripts/publish-refresh.mjs', 'full']);
    log('Published AM full digest run');
  }
} catch (error) {
  log(`Failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
