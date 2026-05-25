import assert from 'node:assert/strict';
import test from 'node:test';
import { isMissingCwdError } from '../lib/util.mjs';

test('isMissingCwdError recognizes common missing-path failures', () => {
  assert.equal(isMissingCwdError(new Error('Path not found.')), true);
  assert.equal(isMissingCwdError(new Error('ENOENT: no such file or directory')), true);
  assert.equal(isMissingCwdError(new Error('permission denied')), false);
});
