import assert from 'node:assert/strict';
import test from 'node:test';
import { forceKillCommand } from '../lib/process-cleanup.mjs';
import { cleanDisplayPath, isMissingCwdError } from '../lib/util.mjs';

test('isMissingCwdError recognizes common missing-path failures', () => {
  assert.equal(isMissingCwdError(new Error('Path not found.')), true);
  assert.equal(isMissingCwdError(new Error('ENOENT: no such file or directory')), true);
  assert.equal(isMissingCwdError(new Error('permission denied')), false);
});

test('cleanDisplayPath removes Windows extended-length prefixes', () => {
  assert.equal(cleanDisplayPath('\\\\?\\C:\\Users\\apple\\project\\file.png'), 'C:\\Users\\apple\\project\\file.png');
  assert.equal(cleanDisplayPath('\\\\?\\UNC\\server\\share\\file.png'), '\\\\server\\share\\file.png');
  assert.equal(cleanDisplayPath('C:\\Users\\apple\\project\\file.png'), 'C:\\Users\\apple\\project\\file.png');
});

test('forceKillCommand targets Windows process trees only', () => {
  assert.deepEqual(forceKillCommand(1234, 'win32'), {
    command: 'taskkill',
    args: ['/PID', '1234', '/T', '/F'],
  });
  assert.equal(forceKillCommand(1234, 'linux'), null);
  assert.equal(forceKillCommand(null, 'win32'), null);
});
