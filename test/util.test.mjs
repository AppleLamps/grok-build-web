import assert from 'node:assert/strict';
import test from 'node:test';
import { isMissingCwdError } from '../lib/util.mjs';
import { forceKillCommand } from '../lib/process-cleanup.mjs';

test('isMissingCwdError recognizes common missing-path failures', () => {
  assert.equal(isMissingCwdError(new Error('Path not found.')), true);
  assert.equal(isMissingCwdError(new Error('ENOENT: no such file or directory')), true);
  assert.equal(isMissingCwdError(new Error('permission denied')), false);
});

test('forceKillCommand targets Windows process trees only', () => {
  assert.deepEqual(forceKillCommand(1234, 'win32'), {
    command: 'taskkill',
    args: ['/PID', '1234', '/T', '/F'],
  });
  assert.equal(forceKillCommand(1234, 'linux'), null);
  assert.equal(forceKillCommand(null, 'win32'), null);
});
