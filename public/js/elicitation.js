// Elicitation request cards. The agent uses these when it needs structured
// user input before it can continue a turn.

import { state } from './state.js';
import { newTurn, autoScroll, addError } from './chat.js';
import { postElicitation } from './api.js';

function schemaFor(request) {
  return request?.requestedSchema ?? request?.schema ?? {};
}

function titleFor(request) {
  return request?.title ?? request?.message ?? request?.prompt ?? 'Input requested';
}

function choicesFor(schema) {
  if (Array.isArray(schema.enum)) return schema.enum.map((value) => ({ value, label: String(value) }));
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((item) => ({
      value: item.const ?? item.value ?? item.title,
      label: item.title ?? item.label ?? String(item.const ?? item.value ?? ''),
    }));
  }
  return [];
}

function addField(form, key, schema, required) {
  const wrap = document.createElement('label');
  wrap.className = 'elicitation-field';
  const label = document.createElement('span');
  label.textContent = schema.title ?? key;
  wrap.appendChild(label);

  const choices = choicesFor(schema);
  let input;
  if (choices.length) {
    input = document.createElement('select');
    for (const choice of choices) {
      const opt = document.createElement('option');
      opt.value = choice.value;
      opt.textContent = choice.label;
      input.appendChild(opt);
    }
  } else if (schema.type === 'boolean') {
    input = document.createElement('input');
    input.type = 'checkbox';
  } else {
    input = document.createElement('input');
    input.type = schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text';
  }

  input.name = key;
  input.dataset.type = schema.type ?? '';
  input.required = required && input.type !== 'checkbox';
  wrap.appendChild(input);
  if (schema.description) {
    const help = document.createElement('small');
    help.textContent = schema.description;
    wrap.appendChild(help);
  }
  form.appendChild(wrap);
}

function collect(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.dataset.type === 'number' || el.dataset.type === 'integer') {
      out[el.name] = el.value === '' ? null : Number(el.value);
    } else {
      out[el.name] = el.value;
    }
  }
  return out;
}

export function addElicitationCard(rpcId, request) {
  if (!state.turnEl) newTurn();
  const card = document.createElement('div');
  card.className = 'elicitation-card';
  card.innerHTML = `
    <div class="elicitation-head">Input requested</div>
    <div class="elicitation-title"></div>
    <div class="elicitation-body"></div>
    <div class="resolution"></div>
  `;
  card.querySelector('.elicitation-title').textContent = titleFor(request);

  const body = card.querySelector('.elicitation-body');
  if (request?.mode === 'url') {
    renderUrl(card, body, rpcId, request);
  } else {
    renderForm(card, body, rpcId, request);
  }

  state.turnEl.appendChild(card);
  state.elicitationCards.set(rpcId, card);
  autoScroll();
}

export function resolveElicitationCard(rpcId, action) {
  const card = state.elicitationCards.get(rpcId);
  if (!card) return;
  card.classList.add('resolved');
  card.querySelectorAll('button, input, select').forEach(el => el.disabled = true);
  card.querySelector('.resolution').textContent = `-> ${action}`;
  state.elicitationCards.delete(rpcId);
}

function renderForm(card, body, rpcId, request) {
  const schema = schemaFor(request);
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const form = document.createElement('form');
  form.className = 'elicitation-form';

  const entries = Object.entries(props);
  if (entries.length) {
    for (const [key, field] of entries) addField(form, key, field ?? {}, required.has(key));
  } else {
    addField(form, 'response', { type: 'string', title: 'Response' }, true);
  }

  const actions = document.createElement('div');
  actions.className = 'elicitation-actions';
  actions.innerHTML = `
    <button class="accept" type="submit">Submit</button>
    <button class="decline" type="button">Decline</button>
    <button class="cancel" type="button">Cancel</button>
  `;
  form.appendChild(actions);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    respond(card, rpcId, 'accept', collect(form));
  });
  actions.querySelector('.decline').addEventListener('click', () => respond(card, rpcId, 'decline'));
  actions.querySelector('.cancel').addEventListener('click', () => respond(card, rpcId, 'cancel'));
  body.appendChild(form);
}

function renderUrl(card, body, rpcId, request) {
  const url = request.url ?? request.uri ?? request.href;
  const detail = document.createElement('div');
  detail.className = 'elicitation-detail';
  detail.textContent = url || 'Open the requested URL, then confirm when finished.';
  body.appendChild(detail);

  const actions = document.createElement('div');
  actions.className = 'elicitation-actions';
  actions.innerHTML = `
    <button class="open" type="button">Open URL</button>
    <button class="accept" type="button">Continue</button>
    <button class="decline" type="button">Decline</button>
    <button class="cancel" type="button">Cancel</button>
  `;
  actions.querySelector('.open').disabled = !url;
  actions.querySelector('.open').addEventListener('click', () => window.open(url, '_blank', 'noopener'));
  actions.querySelector('.accept').addEventListener('click', () => respond(card, rpcId, 'accept'));
  actions.querySelector('.decline').addEventListener('click', () => respond(card, rpcId, 'decline'));
  actions.querySelector('.cancel').addEventListener('click', () => respond(card, rpcId, 'cancel'));
  body.appendChild(actions);
}

async function respond(card, rpcId, action, content) {
  card.querySelectorAll('button, input, select').forEach(el => el.disabled = true);
  try {
    const r = await postElicitation(rpcId, action, content);
    if (!r.ok) throw new Error(await r.text());
  } catch (e) {
    addError(`elicitation response failed: ${e.message}`);
    card.querySelectorAll('button, input, select').forEach(el => el.disabled = false);
  }
}
