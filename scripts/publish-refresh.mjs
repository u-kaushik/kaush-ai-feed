#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const mode = (process.argv[2] || 'full').toLowerCase();
const allowedPaths = [
  'data/ai-feed.json',
  'scripts/scheduled-refresh.mjs',
  'scripts/publish-refresh.mjs',
  'package.json',
  'package-lock.json',
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: process.env,
  });
}

function getChangedAllowedPaths() {
  const out = run('git', ['status', '--porcelain', '--', ...allowedPaths], { capture: true });
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.slice(3))
    .filter((path, index, arr) => allowedPaths.includes(path) && arr.indexOf(path) === index);
}

const changedPaths = getChangedAllowedPaths();
if (!changedPaths.length) {
  console.log('ai-digest: no publishable changes to commit');
  process.exit(0);
}

run('git', ['add', '--', ...changedPaths]);
const message = mode === 'pm' || mode === 'refresh'
  ? 'Refresh AI digest feed'
  : 'Update AI digest morning briefing';
run('git', ['commit', '-m', message]);
run('git', ['push', 'origin', 'HEAD']);
console.log(`ai-digest: published ${changedPaths.join(', ')}`);
