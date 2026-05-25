import { escapeHTML } from './shared.mjs';

export function renderSchedulerDetails(update) {
  const raw = update.rawInput ?? {};
  const out = update.rawOutput ?? {};
  const title = (update.title ?? '').toLowerCase();
  if (/create/.test(title)) {
    const interval = raw.interval ?? raw.cron ?? '';
    const prompt = raw.prompt ?? raw.command ?? '';
    return `
      <div class="label">interval</div><pre>${escapeHTML(interval)}</pre>
      <div class="label">prompt</div><pre>${escapeHTML(prompt)}</pre>
      ${out.id ? `<div class="label">id</div><pre>${escapeHTML(out.id)}</pre>` : ''}
    `;
  }
  if (/delete/.test(title)) {
    return `<div class="label">deleted</div><pre>${escapeHTML(raw.id ?? out.id ?? '(unknown id)')}</pre>`;
  }
  const items = out.schedules ?? out.tasks ?? (Array.isArray(out) ? out : null);
  if (Array.isArray(items)) {
    if (items.length === 0) return `<div class="label">schedules</div><em style="color:var(--mute)">No scheduled tasks.</em>`;
    const rows = items.map(s => `
      <tr>
        <td><code>${escapeHTML(s.id ?? '')}</code></td>
        <td><code>${escapeHTML(s.interval ?? s.cron ?? '')}</code></td>
        <td>${escapeHTML((s.prompt ?? s.command ?? '').slice(0, 80))}</td>
        <td>${escapeHTML(s.next_run ?? s.next ?? '')}</td>
      </tr>
    `).join('');
    return `
      <div class="label">schedules · ${items.length}</div>
      <table class="sched-table">
        <thead><tr><th>ID</th><th>Interval</th><th>Prompt</th><th>Next run</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
  return null;
}
