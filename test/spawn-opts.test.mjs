import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentArgv, createDefaultSpawnOpts, validateSpawnOptsPatch } from '../lib/spawn-opts.mjs';

test('buildAgentArgv includes primary agent and inline subagent JSON', () => {
  const opts = {
    ...createDefaultSpawnOpts(),
    agent: 'reviewer',
    agents: '[{"name":"fast","description":"Quick pass"}]',
    alwaysApprove: false,
  };

  assert.deepEqual(buildAgentArgv(opts), [
    '--agent',
    'reviewer',
    '--agents',
    '[{"name":"fast","description":"Quick pass"}]',
    'agent',
    'stdio',
  ]);
});

test('validateSpawnOptsPatch rejects invalid inline agents JSON', () => {
  assert.doesNotThrow(() => validateSpawnOptsPatch({ agents: '[{"name":"fast"}]' }));
  assert.throws(() => validateSpawnOptsPatch({ agents: '{' }), /agents must be valid JSON/);
  assert.throws(() => validateSpawnOptsPatch({ agents: true }), /agents must be a JSON string/);
});
