import { spawnSync } from 'node:child_process';
import { AGENT_HELP_TIMEOUT_MS, GROK_BIN, GROK_BIN_ARGS } from './config.mjs';

let agentHelpText = null;

export function getAgentHelpText() {
  if (agentHelpText !== null) return agentHelpText;
  const r = spawnSync(GROK_BIN, [...GROK_BIN_ARGS, 'agent', '--help'], {
    encoding: 'utf8',
    timeout: AGENT_HELP_TIMEOUT_MS,
    windowsHide: true,
  });
  agentHelpText = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  return agentHelpText;
}

export function agentSupportsFlag(flag) {
  return getAgentHelpText().includes(flag);
}

export function agentCapabilities() {
  return {
    alwaysApprove: agentSupportsFlag('--always-approve'),
    noLeader: agentSupportsFlag('--no-leader'),
    permissionMode: agentSupportsFlag('--permission-mode'),
  };
}
