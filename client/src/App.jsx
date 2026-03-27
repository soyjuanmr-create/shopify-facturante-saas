import React from 'react';
import { AppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import es from '@shopify/polaris/locales/es.json';
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import OrdersPage from './pages/OrdersPage';
import SettingsPage from './pages/SettingsPage';
import ErrorBoundary from './components/ErrorBoundary';

// Usa <a> plain en vez de <Link> para evitar que React Router agregue aria-current
function NavMenu() {
  const navigate = useNavigate();
  function go(e, to) { e.preventDefault(); navigate(to); }
  return (
    <ui-nav-menu>
      <a href="/" rel="home" onClick={e => go(e, '/')}>Inicio</a>
      <a href="/orders" onClick={e => go(e, '/orders')}>Ordenes</a>
      <a href="/settings" onClick={e => go(e, '/settings')}>Configuracion</a>
    </ui-nav-menu>
  );
}

export default function App() {
  return (
    <AppProvider i18n={es} features={{ polarisSummerEditions2023: true }}>
      <BrowserRouter>
        <NavMenu />
        <ErrorBoundary>
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
