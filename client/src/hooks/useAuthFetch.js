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
      if (res.status === 402 && err.billingRequired && err.confirmationUrl) {
        // Sin suscripcion activa: llevar al merchant a aprobar el plan (con trial)
        window.open(err.confirmationUrl, '_top');
        return new Promise(() => { }); // Freeze execution while redirecting
      }
      if (res.status === 403 && err.authRequired) {
        // Extraer shop del JWT (dest claim) — más confiable que URL params o shopify.config
        let shop = null;
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          shop = new URL(payload.dest).hostname;
        } catch (e) {
          // fallback a URL params o App Bridge config
          const urlParams = new URLSearchParams(window.location.search);
          shop = urlParams.get('shop') || (window.shopify && window.shopify.config && window.shopify.config.shop);
        }
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
