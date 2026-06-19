export function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  const { className, text, attrs = {}, dataset = {}, props = {}, on = {} } = options ?? {};
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  for (const [name, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    node.setAttribute(name, value === true ? '' : String(value));
  }
  for (const [name, value] of Object.entries(dataset)) {
    if (value != null) node.dataset[name] = String(value);
  }
  Object.assign(node, props);
  for (const [type, handler] of Object.entries(on)) {
    node.addEventListener(type, handler);
  }
  append(node, ...children);
  return node;
}

function text(value) {
  return document.createTextNode(String(value ?? ''));
}

export function clear(node) {
  if (!node) return;
  node.replaceChildren?.();
  if (!node.replaceChildren) node.innerHTML = '';
}

export function append(parent, ...children) {
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    parent.appendChild(typeof child === 'string' ? text(child) : child);
  }
  return parent;
}
