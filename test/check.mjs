import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['server.mjs', 'public', 'test'];
const files = [];

for (const root of roots) collect(root);

for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function collect(path) {
  const st = statSync(path);
  if (st.isFile()) {
    if (/\.(mjs|js)$/.test(path)) files.push(path);
    return;
  }
  for (const name of readdirSync(path)) collect(join(path, name));
}
