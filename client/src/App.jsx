import React, { useEffect } from 'react';
import { AppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import es from '@shopify/polaris/locales/es.json';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import OrdersPage from './pages/OrdersPage';
import SettingsPage from './pages/SettingsPage';

function AppNav() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    let nav = document.querySelector('s-app-nav');
    if (!nav) { nav = document.createElement('s-app-nav'); document.body.prepend(nav); }
    const items = [
      { label: 'Inicio', destination: '/' },
      { label: 'Ordenes', destination: '/orders' },
      { label: 'Configuracion', destination: '/settings' },
    ];
    nav.innerHTML = '';
    items.forEach(item => {
      const a = document.createElement('a');
      a.href = item.destination;
      a.textContent = item.label;
      if (location.pathname === item.destination) a.setAttribute('aria-current', 'page');
      a.addEventListener('click', e => { e.preventDefault(); navigate(item.destination); });
      nav.appendChild(a);
    });
  }, [location.pathname, navigate]);
  return null;
}

export default function App() {
  return (
    <AppProvider i18n={es}>
      <BrowserRouter>
        <AppNav />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}
