function normalizeStderrLine(line) {
  return String(line)
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '<timestamp>')
    .replace(/session_id=[0-9a-f-]+/gi, 'session_id=<session>')
    .trim();
}

export class StderrRateLimiter {
  constructor({ prefix = '[grok] ', windowMs = 5000 } = {}) {
    this.prefix = prefix;
    this.windowMs = windowMs;
    this.buf = '';
    this.lines = new Map();
  }

  write(chunk) {
    this.buf += chunk.toString();
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.writeLine(line);
    }
  }

  writeLine(line) {
    const key = normalizeStderrLine(line);
    if (!key) return;
    let entry = this.lines.get(key);
    if (!entry) {
      entry = { count: 0, timer: null };
      this.lines.set(key, entry);
      process.stderr.write(`${this.prefix}${line}\n`);
      entry.timer = setTimeout(() => this.flush(key), this.windowMs);
      return;
    }
    entry.count++;
  }

  flush(key) {
    const entry = this.lines.get(key);
    if (!entry) return;
    if (entry.count > 0) {
      process.stderr.write(`${this.prefix}suppressed ${entry.count} repeated stderr line${entry.count === 1 ? '' : 's'}: ${key}\n`);
    }
    this.lines.delete(key);
  }

  flushAll() {
    if (this.buf.trim()) this.writeLine(this.buf.trim());
    this.buf = '';
    for (const key of Array.from(this.lines.keys())) this.flush(key);
  }
}
