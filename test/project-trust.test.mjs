import assert from 'node:assert/strict';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ensureCurrentProjectTrusted } from '../lib/project-trust.mjs';
import { withTempDir } from './helpers.mjs';

test('ensureCurrentProjectTrusted writes Grok trust entry under HOME', async () => {
  await withTempDir('grok-web-trust-', async (temp) => {
    const oldHome = process.env.HOME;
    const oldGrokHome = process.env.GROK_HOME;
    const oldUserProfile = process.env.USERPROFILE;
    const home = join(temp, 'home');
    const project = join(temp, 'project');

    try {
      await mkdir(project, { recursive: true });
      process.env.HOME = home;
      process.env.USERPROFILE = home;
      delete process.env.GROK_HOME;

      const first = await ensureCurrentProjectTrusted(project);
      assert.equal(first.changed, true);

      const trustFile = join(home, '.grok', 'trusted-hook-projects');
      const trusted = await readFile(trustFile, 'utf8');
      const canonicalProject = await realpath(project);
      const expected = process.platform === 'win32' ? `\\\\?\\${canonicalProject}` : canonicalProject;
      assert.equal(trusted.trim(), expected);

      const second = await ensureCurrentProjectTrusted(project);
      assert.equal(second.changed, false);
      assert.equal((await readFile(trustFile, 'utf8')).trim(), expected);
    } finally {
      if (oldHome === undefined) delete process.env.HOME;
      else process.env.HOME = oldHome;
      if (oldGrokHome === undefined) delete process.env.GROK_HOME;
      else process.env.GROK_HOME = oldGrokHome;
      if (oldUserProfile === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = oldUserProfile;
    }
  });
});
