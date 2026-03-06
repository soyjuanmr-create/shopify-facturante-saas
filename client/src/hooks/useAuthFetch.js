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
      if (res.status === 403 && err.authRequired) {
        // Obtenemos el origin o domain de shopify usando query o window params y redirigimos a la ruta OAuth
        const urlParams = new URLSearchParams(window.location.search);
        let shop = urlParams.get('shop') || (window.shopify && window.shopify.config && window.shopify.config.shop);
        if (shop) {
          window.open('/api/auth?shop=' + encodeURIComponent(shop), '_top');
          return new Promise(() => { }); // Freeze execution while redirecting
        }
      }
      throw new Error(err.error || 'HTTP ' + res.status);
    }
    return res.json();
  }, []);
}
