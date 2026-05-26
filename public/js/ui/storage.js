export function getString(key, fallback = null) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function setString(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
  } catch {
    /* ignore unavailable storage */
  }
}

export function getBoolean(key, fallback = false) {
  const value = getString(key, null);
  if (value == null) return fallback;
  return value === '1' || value === 'true';
}

export function setBoolean(key, value) {
  setString(key, value ? '1' : '0');
}

export function getJson(key, fallback) {
  const value = getString(key, null);
  if (value == null) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function setJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore unavailable storage */
  }
}
