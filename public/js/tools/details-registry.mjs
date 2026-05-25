import { toolTitle } from './shared.mjs';
import { isXSearchTool } from './summarize.mjs';
import { renderEditDetails } from './render-edit.mjs';
import { renderTodos, isTodoUpdate } from './render-todos.mjs';
import { renderBrowserDetails } from './render-browser.mjs';
import { renderTerminalDetails } from './render-terminal.mjs';
import { renderVideoDetails, renderImageDetails, renderMultimodalDetails } from './render-multimodal.mjs';
import { renderSearchDetails } from './render-search.mjs';
import { renderSchedulerDetails } from './render-scheduler.mjs';

export const DETAIL_RENDERERS = [
  { match: (u) => u.kind === 'edit', render: renderEditDetails },
  { match: (u) => isTodoUpdate(u, toolTitle(u)), render: renderTodos },
  { match: (u) => /browser[_ -]?(tab|network)/.test(toolTitle(u)), render: renderBrowserDetails },
  { match: (u) => u.kind === 'execute' || /run_terminal_command/.test(toolTitle(u)), render: renderTerminalDetails },
  { match: (u) => /video[_ -]?gen|imagine[_ -]?video/.test(toolTitle(u)), render: renderVideoDetails },
  { match: (u) => /image[_ -]?gen|imagine/.test(toolTitle(u)), render: renderImageDetails },
  {
    match: (u) => isXSearchTool(toolTitle(u), u.rawInput),
    render: (u) => renderSearchDetails(u, 'x'),
  },
  {
    match: (u) => /web[_ -]?search/.test(toolTitle(u)) || u.kind === 'search',
    render: (u) => renderSearchDetails(u, 'web'),
  },
  { match: (u) => u.kind === 'read', render: renderMultimodalDetails },
  { match: (u) => /scheduler/.test(toolTitle(u)), render: renderSchedulerDetails },
];

export function renderToolDetails(update) {
  for (const { match, render } of DETAIL_RENDERERS) {
    if (match(update)) return render(update);
  }
  return null;
}

export function __testRenderToolDetails(update) {
  const html = renderToolDetails(update);
  if (html) return html;
  return renderMultimodalDetails(update);
}
