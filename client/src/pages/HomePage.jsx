import React, { useState, useEffect, useCallback } from 'react';
import { Page, Layout, Card, Text, Banner, BlockStack, InlineStack, Button, Badge, SkeletonBodyText, CalloutCard, Icon } from '@shopify/polaris';
import { CheckCircleIcon, OrderIcon, ReceiptIcon, ClockIcon, AlertTriangleIcon } from '@shopify/polaris-icons';
import { useNavigate } from 'react-router-dom';
import { useAuthFetch } from '../hooks/useAuthFetch';

export default function HomePage() {
  const fetch = useAuthFetch();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, st] = await Promise.all([
        fetch('/api/settings'),
        fetch('/api/invoices/stats').catch(() => ({ total: 0, invoiced: 0, pending: 0, errors: 0 })),
      ]);
      setSettings(s); setStats(st);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [fetch]);

  useEffect(() => { load(); }, [load]);
  var isConfigured = settings && settings.hasCredentials;

  if (loading) return (<Page title="Shopifac"><Layout><Layout.Section><Card><SkeletonBodyText lines={4} /></Card></Layout.Section></Layout></Page>);

  return (
    <Page title="Shopifac" subtitle="Facturacion electronica para Argentina">
      <BlockStack gap="500">
        {error && <Banner title="Error" tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        {isConfigured ? (
          <Banner title="Facturante conectado" tone="success">
            <p>Las facturas se {settings.autoInvoice ? 'emiten automaticamente al recibir un pago' : 'pueden emitir manualmente desde Ordenes'}.</p>
          </Banner>
        ) : !dismissed ? (
          <CalloutCard title="Bienvenido a Shopifac" illustration="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png" primaryAction={{ content: 'Configurar Facturante', onAction: () => navigate('/settings') }} secondaryAction={{ content: 'Descartar', onAction: () => setDismissed(true) }}>
            <BlockStack gap="200">
              <p>Configura tu cuenta de Facturante en 3 pasos:</p>
              <InlineStack gap="200" blockAlign="center"><Badge tone="info">1</Badge><Text as="span">Credenciales de Facturante.com</Text></InlineStack>
              <InlineStack gap="200" blockAlign="center"><Badge tone="info">2</Badge><Text as="span">Punto de venta AFIP</Text></InlineStack>
              <InlineStack gap="200" blockAlign="center"><Badge tone="info">3</Badge><Text as="span">Modo automatico o manual</Text></InlineStack>
            </BlockStack>
          </CalloutCard>
        ) : (
          <Banner title="Configuracion pendiente" tone="warning" action={{ content: 'Configurar', onAction: () => navigate('/settings') }}>
            <p>Conecta tu cuenta de Facturante para empezar.</p>
          </Banner>
        )}
        {isConfigured && stats && (
          <InlineStack gap="400" wrap>
            <Card><BlockStack gap="200"><Text variant="bodySm" tone="subdued">Total</Text><Text variant="headingXl" fontWeight="bold">{stats.total}</Text></BlockStack></Card>
            <Card><BlockStack gap="200"><Text variant="bodySm" tone="subdued">Facturadas</Text><Text variant="headingXl" fontWeight="bold">{stats.invoiced}</Text></BlockStack></Card>
            <Card><BlockStack gap="200"><Text variant="bodySm" tone="subdued">Pendientes</Text><Text variant="headingXl" fontWeight="bold">{stats.pending}</Text></BlockStack></Card>
            <Card><BlockStack gap="200"><Text variant="bodySm" tone="subdued">Con error</Text><Text variant="headingXl" fontWeight="bold">{stats.errors}</Text></BlockStack></Card>
          </InlineStack>
        )}
        {isConfigured && (
          <Card>
            <BlockStack gap="300">
              <Text variant="headingMd">Acciones rapidas</Text>
              <InlineStack gap="300">
                <Button onClick={() => navigate('/orders')}>Ver ordenes</Button>
                <Button variant="plain" onClick={() => navigate('/settings')}>Cambiar configuracion</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
