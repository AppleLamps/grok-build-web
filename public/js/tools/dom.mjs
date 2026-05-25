import { state } from '../state.js';
import { newTurn, autoScroll } from '../chat.js';
import { getSubagentDepth } from '../tool-state.js';

function currentToolGroup() {
  if (!state.turnEl) newTurn();
  const last = state.turnEl.lastElementChild;
  if (last && last.classList?.contains('tool-group')) return last;
  const g = document.createElement('div');
  g.className = 'tool-group';
  g.innerHTML = `
    <span class="tool-group-summary">
      <span class="tool-group-count">1 tool</span>
      <span class="chev">›</span>
    </span>
    <div class="tool-group-items"></div>
  `;
  g.querySelector('.tool-group-summary').addEventListener('click', () => {
    g.classList.toggle('open');
    g.dataset.userToggled = '1';
  });
  state.turnEl.appendChild(g);
  return g;
}

export function getToolEl(id) {
  let el = state.toolEls.get(id);
  if (el) return el;
  const group = currentToolGroup();
  el = document.createElement('div');
  el.className = 'tool';
  if (getSubagentDepth() > 0) el.classList.add('subagent-child');
  el.innerHTML = `
    <span class="summary">
      <span class="status-icon"></span>
      <span class="verb"></span>
      <span class="target"></span>
      <span class="delta-add"></span>
      <span class="delta-del"></span>
      <span class="chev">›</span>
    </span>
    <div class="details"></div>
  `;
  el.querySelector('.summary').addEventListener('click', (e) => {
    e.stopPropagation();
    el.classList.toggle('open');
  });
  group.querySelector('.tool-group-items').appendChild(el);
  state.toolEls.set(id, el);
  const count = group.querySelector('.tool-group-items').children.length;
  group.querySelector('.tool-group-count').textContent = count === 1 ? '1 tool' : `${count} tools`;
  group.classList.toggle('is-grouped', count > 2);
  if (!group.dataset.userToggled) {
    if (count <= 2) group.classList.add('open');
    else group.classList.remove('open');
  }
  autoScroll();
  return el;
}
