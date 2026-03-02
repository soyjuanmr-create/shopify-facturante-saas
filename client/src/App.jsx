import React, { useEffect } from 'react';
import { AppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import es from '@shopify/polaris/locales/es.json';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import OrdersPage from './pages/OrdersPage';
import SettingsPage from './pages/SettingsPage';
import ErrorBoundary from './components/ErrorBoundary';

const NAV_ITEMS = [
  { label: 'Inicio', destination: '/' },
  { label: 'Ordenes', destination: '/orders' },
  { label: 'Configuracion', destination: '/settings' },
];

function AppNav() {
  const location = useLocation();
  const navigate = useNavigate();

  // Build nav once on mount
  useEffect(() => {
    let nav = document.querySelector('s-app-nav');
    if (!nav) {
      nav = document.createElement('s-app-nav');
      document.body.prepend(nav);
      NAV_ITEMS.forEach(item => {
        const a = document.createElement('a');
        a.href = item.destination;
        a.textContent = item.label;
        a.dataset.dest = item.destination;
        a.addEventListener('click', e => { e.preventDefault(); navigate(item.destination); });
        nav.appendChild(a);
      });
    }
  }, [navigate]);

  // Update aria-current on route change only
  useEffect(() => {
    const nav = document.querySelector('s-app-nav');
    if (!nav) return;
    nav.querySelectorAll('a[data-dest]').forEach(a => {
      if (a.dataset.dest === location.pathname) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }, [location.pathname]);

  return null;
}

export default function App() {
  return (
    <AppProvider i18n={es}>
      <BrowserRouter>
        <ErrorBoundary>
          <AppNav />
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AppProvider>
  );
}
