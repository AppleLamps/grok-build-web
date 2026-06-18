import { agentSupportsFlag, launchSupportsFlag } from './agent-help.mjs';

export function createDefaultSpawnOpts() {
  return {
    effort: null,
    reasoningEffort: null,
    maxTurns: null,
    sandbox: null,
    model: null,
    agent: null,
    agents: null,
    rules: null,
    systemPromptOverride: null,
    allow: [],
    deny: [],
    tools: null,
    disallowedTools: null,
    disableWebSearch: false,
    noSubagents: false,
    noPlan: false,
    noMemory: false,
    todoGate: false,
    restoreCode: false,
    alwaysApprove: true,
    noLeader: false,
    permissionMode: null,
    compactionMode: null,
    compactionDetail: null,
    ignoreApiKey: !process.env.GROK_WEB_USE_API_KEY,
  };
}

export function buildAgentArgv(spawnOpts) {
  const a = [];
  const o = spawnOpts;
  if (o.restoreCode) a.push('--restore-code');
  if (o.effort) a.push('--effort', o.effort);
  if (o.reasoningEffort) a.push('--reasoning-effort', o.reasoningEffort);
  if (o.maxTurns) a.push('--max-turns', String(o.maxTurns));
  if (o.sandbox) a.push('--sandbox', o.sandbox);
  if (o.model) a.push('--model', o.model);
  if (o.agent) a.push('--agent', o.agent);
  if (o.agents) a.push('--agents', o.agents);
  if (o.rules) a.push('--rules', o.rules);
  if (o.systemPromptOverride) a.push('--system-prompt-override', o.systemPromptOverride);
  for (const r of o.allow ?? []) a.push('--allow', r);
  for (const r of o.deny ?? []) a.push('--deny', r);
  if (o.tools) a.push('--tools', o.tools);
  if (o.disallowedTools) a.push('--disallowed-tools', o.disallowedTools);
  if (o.disableWebSearch) a.push('--disable-web-search');
  if (o.noSubagents) a.push('--no-subagents');
  if (o.noPlan) a.push('--no-plan');
  if (o.noMemory) a.push('--no-memory');
  if (o.todoGate && launchSupportsFlag('--todo-gate')) a.push('--todo-gate');
  if (o.alwaysApprove && launchSupportsFlag('--always-approve')) a.push('--always-approve');
  if (o.noLeader && agentSupportsFlag('--no-leader')) a.push('--no-leader');
  if (o.permissionMode && launchSupportsFlag('--permission-mode')) a.push('--permission-mode', o.permissionMode);
  if (o.compactionMode && launchSupportsFlag('--compaction-mode')) a.push('--compaction-mode', o.compactionMode);
  if (o.compactionDetail && launchSupportsFlag('--compaction-detail')) a.push('--compaction-detail', o.compactionDetail);
  a.push('agent', 'stdio');
  return a;
}

export function validateSpawnOptsPatch(patch = {}) {
  if (!patch || typeof patch !== 'object') return;
  if (patch.agents == null || patch.agents === '') return;
  if (typeof patch.agents !== 'string') throwValidationError('agents must be a JSON string');
  try {
    JSON.parse(patch.agents);
  } catch (e) {
    throwValidationError(`agents must be valid JSON: ${e.message}`);
  }
}

function throwValidationError(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}
