import React from 'react';
import { AppProvider } from '@shopify/polaris';
import '@shopify/polaris/build/esm/styles.css';
import es from '@shopify/polaris/locales/es.json';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import HomePage from './pages/HomePage';
import OrdersPage from './pages/OrdersPage';
import SettingsPage from './pages/SettingsPage';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <AppProvider i18n={es} features={{ polarisSummerEditions2023: true }}>
      <BrowserRouter>
        <ui-nav-menu>
          <Link to="/" rel="home">Inicio</Link>
          <Link to="/orders">Ordenes</Link>
          <Link to="/settings">Configuracion</Link>
        </ui-nav-menu>
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
