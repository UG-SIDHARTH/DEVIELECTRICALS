let inMemoryCsrfToken = null;
let onAuthFailureCallback = null;

export function setCsrfToken(token) {
  inMemoryCsrfToken = token;
}

export function getCsrfToken() {
  return inMemoryCsrfToken;
}

export function setAuthFailureHandler(callback) {
  onAuthFailureCallback = callback;
}

export async function apiFetch(endpoint, options = {}) {
  const headers = {
    ...options.headers
  };

  const method = options.method || 'GET';

  // State-changing requests attach CSRF header
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method.toUpperCase())) {
    if (inMemoryCsrfToken) {
      headers['X-CSRF-Token'] = inMemoryCsrfToken;
    }
  }

  // Set JSON content-type if body is JSON object and not FormData / ArrayBuffer
  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData) && !(options.body instanceof ArrayBuffer) && !(options.body instanceof Uint8Array)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'same-origin'
  });

  if (response.status === 401) {
    if (onAuthFailureCallback) {
      onAuthFailureCallback();
    }
    throw new Error('Session expired or unauthorized');
  }

  if (!response.ok) {
    let errMessage = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errMessage = errJson.error || errMessage;
    } catch {
      // Non-JSON response
    }
    throw new Error(errMessage);
  }

  // Handle CSV/text downloads
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/csv')) {
    return await response.text();
  }

  if (response.status === 204) {
    return null;
  }

  return await response.json();
}

export const api = {
  get: (url, opts) => apiFetch(url, { ...opts, method: 'GET' }),
  post: (url, body, opts) => apiFetch(url, { ...opts, method: 'POST', body }),
  put: (url, body, opts) => apiFetch(url, { ...opts, method: 'PUT', body }),
  del: (url, opts) => apiFetch(url, { ...opts, method: 'DELETE' })
};

export default api;
