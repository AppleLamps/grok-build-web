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

export function text(value) {
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

export function button(label, options = {}) {
  const { className, title, ariaLabel, type = 'button', attrs = {}, on = {} } = options;
  return el('button', {
    className,
    text: label,
    attrs: {
      type,
      title,
      'aria-label': ariaLabel,
      ...attrs,
    },
    on,
  });
}

export function iconButton(label, options = {}) {
  return button(label, {
    ...options,
    attrs: {
      ...options.attrs,
      title: options.title ?? label,
      'aria-label': options.ariaLabel ?? label,
    },
  });
}

export function trustedSvg(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}
