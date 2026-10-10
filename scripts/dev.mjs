import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, PORT: process.env.PORT ?? '3001' };
const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');

const serverArgs = existsSync(tsxCli)
  ? [tsxCli, 'watch', 'src/server/index.ts']
  : ['--import', 'tsx', 'src/server/index.ts'];

const children = [
  spawn(process.execPath, serverArgs, { cwd: root, env, stdio: 'inherit' }),
  spawn(process.execPath, [viteBin], { cwd: root, env, stdio: 'inherit' }),
];

function shutdown() {
  for (const child of children) child.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

for (const child of children) {
  child.on('exit', (code) => {
    if (code && code !== 0) {
      for (const other of children) other.kill();
      process.exit(code);
    }
  });
}
