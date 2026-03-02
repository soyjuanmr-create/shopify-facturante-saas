import { useCallback } from 'react';

export function useAuthFetch() {
  return useCallback(async (url, options = {}) => {
    const token = await shopify.idToken();
    const res = await fetch(url, {
      ...options,
      headers: { ...options.headers, 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'HTTP ' + res.status);
    }
    return res.json();
  }, []);
}
