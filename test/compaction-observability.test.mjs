import assert from 'node:assert/strict';
import test from 'node:test';
import { importFresh, importPublic, installDomStubs } from './helpers.mjs';

test('dispatch surfaces compaction metadata updates', async () => {
  installDomStubs();
  const dispatchMod = await importFresh('public/js/dispatch.js');
  const { state, dom } = await importPublic('public/js/state.js');

  dispatchMod.dispatch({
    kind: 'update',
    update: {
      sessionUpdate: 'session_compaction_result',
      before_tokens: 100000,
      after_tokens: 42000,
      transcript_path: 'C:\\Users\\apple\\.grok\\sessions\\transcript.md',
      prompt_prefix_reused: true,
      summary_quality: 'good',
    },
  });

  assert.equal(state.lastCompaction.beforeTokens, 100000);
  assert.equal(state.lastCompaction.afterTokens, 42000);
  assert.equal(state.lastCompaction.promptPrefixReused, true);
  assert.match(dom.logInner.textContent, /Compaction/);
  assert.match(dom.logInner.textContent, /100K -> 42K tokens/);
  assert.match(dom.logInner.textContent, /58% reduction/);
  assert.match(dom.logInner.textContent, /transcript C:\\Users\\apple\\.grok\\sessions\\transcript\.md/);
});
