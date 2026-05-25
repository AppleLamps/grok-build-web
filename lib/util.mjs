import { resolve, sep } from 'node:path';
import { userInfo } from 'node:os';

export function errorMessage(error) {
  if (error == null) return 'unknown error';
  if (typeof error === 'string') return error;
  if (typeof error.message === 'string') return error.message;
  try {
    const json = JSON.stringify(error);
    return json === undefined ? String(error) : json;
  } catch {
    return String(error);
  }
}

export function rpcErrorMessage(error) {
  return errorMessage(error || 'unknown RPC error');
}

export function isWithinPath(root, file) {
  const rootPath = resolve(root);
  const filePath = resolve(file);
  const rootCmp = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath;
  const fileCmp = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  return fileCmp === rootCmp || fileCmp.startsWith(rootCmp + sep);
}

export function positiveIntegerOption(value, name) {
  if (value == null || value === '') return null;
  const ok = (typeof value === 'number' && Number.isInteger(value))
    || (typeof value === 'string' && /^\d+$/.test(value.trim()));
  if (!ok) throw new Error(`${name} must be a positive integer`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function mergeHistoryEntries(a, b) {
  const merged = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (j >= b.length || (i < a.length && a[i].seq <= b[j].seq)) merged.push(a[i++]);
    else merged.push(b[j++]);
  }
  return merged;
}

export function defaultUsername() {
  return process.env.GROK_WEB_USER
    ?? process.env.USERNAME
    ?? process.env.USER
    ?? userInfo().username
    ?? 'local';
}

export function hasPathTraversal(value) {
  return String(value ?? '').replace(/\\/g, '/').split('/').some(part => part === '..');
}

export function isMissingCwdError(error) {
  const msg = errorMessage(error).toLowerCase();
  return /path not found|no such file|enoent/.test(msg);
}
