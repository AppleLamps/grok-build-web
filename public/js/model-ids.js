// Shared model ID helpers for settings and the compact model picker.

// `grok models` only lists what the active auth method exposes, so we union
// CLI output with known IDs that the API itself accepts.
export const KNOWN_MODEL_IDS = [
  'grok-build',
  'grok-build-0.1',
  'grok-4.3',
  'grok-4.20-0309-non-reasoning',
  'grok-4.20-0309-reasoning',
  'grok-4.20-multi-agent-0309',
  'grok-imagine-image',
  'grok-imagine-image-quality',
  'grok-imagine-video',
];

export function parseModelIds(text) {
  if (!text) return [];
  const matches = text.match(/grok[-/][a-z0-9._-]+/gi) ?? [];
  return Array.from(new Set(matches));
}

export function mergeModelIds(cliText, current = '') {
  const ids = Array.from(new Set([...parseModelIds(cliText), ...KNOWN_MODEL_IDS]));
  if (current && !ids.includes(current)) ids.push(current);
  return ids;
}
