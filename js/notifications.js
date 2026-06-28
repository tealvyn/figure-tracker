// js/notifications.js
export function toast(message, options = {}) {
  const el = document.createElement('div');
  el.className = 'toast';
  if (options.type) el.dataset.type = options.type;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), options.timeout || 2200);
}

export function showToast(message, options = {}) {
  return toast(message, options);
}

export function showError(message, options = {}) {
  return toast(message, { ...options, type: 'error' });
}

export function showSuccess(message, options = {}) {
  return toast(message, { ...options, type: 'success' });
}
