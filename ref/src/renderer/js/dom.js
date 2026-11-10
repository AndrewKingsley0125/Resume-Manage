// Small DOM helpers shared by the screens.

export const $ = id => document.getElementById(id);

/** el('div', { class: 'x', onclick: fn }, ...children) */
export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
  }
  node.append(...children.filter(c => c != null));
  return node;
};

export const fullName = p => [p.firstName, p.lastName].filter(Boolean).join(' ') || p.id;
