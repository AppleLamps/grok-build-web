import { spawnSync } from 'node:child_process';
import { AGENT_HELP_TIMEOUT_MS, GROK_BIN, GROK_BIN_ARGS } from './config.mjs';

let agentHelpText = null;
let rootHelpText = null;

export function getRootHelpText() {
  if (rootHelpText !== null) return rootHelpText;
  const r = spawnSync(GROK_BIN, [...GROK_BIN_ARGS, '--help'], {
    encoding: 'utf8',
    timeout: AGENT_HELP_TIMEOUT_MS,
    windowsHide: true,
  });
  rootHelpText = `${r.stdout ?? ''}\n${r.stderr ?? ''}`;
  return rootHelpText;
}

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

export function rootSupportsFlag(flag) {
  return getRootHelpText().includes(flag);
}

export function launchSupportsFlag(flag) {
  return rootSupportsFlag(flag) || agentSupportsFlag(flag);
}

export function agentCapabilities() {
  return {
    agent: launchSupportsFlag('--agent'),
    agents: launchSupportsFlag('--agents'),
    alwaysApprove: launchSupportsFlag('--always-approve'),
    noLeader: agentSupportsFlag('--no-leader'),
    permissionMode: launchSupportsFlag('--permission-mode'),
    todoGate: launchSupportsFlag('--todo-gate'),
  };
}
