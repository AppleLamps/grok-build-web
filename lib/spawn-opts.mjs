import { agentSupportsFlag } from './agent-help.mjs';

export function createDefaultSpawnOpts() {
  return {
    effort: null,
    reasoningEffort: null,
    maxTurns: null,
    sandbox: null,
    model: null,
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
    restoreCode: false,
    alwaysApprove: true,
    noLeader: false,
    permissionMode: null,
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
  if (o.rules) a.push('--rules', o.rules);
  if (o.systemPromptOverride) a.push('--system-prompt-override', o.systemPromptOverride);
  for (const r of (o.allow ?? [])) a.push('--allow', r);
  for (const r of (o.deny ?? [])) a.push('--deny', r);
  if (o.tools) a.push('--tools', o.tools);
  if (o.disallowedTools) a.push('--disallowed-tools', o.disallowedTools);
  if (o.disableWebSearch) a.push('--disable-web-search');
  if (o.noSubagents) a.push('--no-subagents');
  if (o.noPlan) a.push('--no-plan');
  if (o.noMemory) a.push('--no-memory');
  if (o.alwaysApprove && agentSupportsFlag('--always-approve')) a.push('--always-approve');
  if (o.noLeader && agentSupportsFlag('--no-leader')) a.push('--no-leader');
  if (o.permissionMode && agentSupportsFlag('--permission-mode')) a.push('--permission-mode', o.permissionMode);
  a.push('agent', 'stdio');
  return a;
}
