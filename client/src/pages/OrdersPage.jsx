import React, { useState, useEffect, useCallback } from 'react';
import { Page, Layout, Card, IndexTable, Text, Badge, Banner, Button, BlockStack, EmptyState, SkeletonBodyText, Modal } from '@shopify/polaris';
import { useAuthFetch } from '../hooks/useAuthFetch';

export default function OrdersPage() {
  const fetch = useAuthFetch();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [invoicingId, setInvoicingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const loadOrders = useCallback(async () => {
    setLoading(true); setError(null);
    try { var d = await fetch('/api/invoices/orders'); setOrders(d.orders || []); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [fetch]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const handleInvoice = useCallback(async () => {
    var id = confirmId; setConfirmId(null); setInvoicingId(id); setError(null); setSuccess(null);
    try {
      var d = await fetch('/api/invoices/generate', { method: 'POST', body: JSON.stringify({ orderId: id }) });
      if (d.success) { setSuccess(d.message); shopify.toast.show(d.message); await loadOrders(); }
      else setError(d.error || 'Error');
    } catch (e) { setError(e.message); } finally { setInvoicingId(null); }
  }, [fetch, confirmId, loadOrders]);

  function statusBadge(s) {
    if (s === 'completed') return <Badge tone="success">Facturada</Badge>;
    if (s === 'processing') return <Badge tone="attention">Procesando</Badge>;
    if (s === 'failed') return <Badge tone="critical">Error</Badge>;
    return <Badge>Pendiente</Badge>;
  }

  if (loading) return (<Page title="Ordenes"><Layout><Layout.Section><Card><SkeletonBodyText lines={8} /></Card></Layout.Section></Layout></Page>);

  return (
    <Page title="Ordenes" primaryAction={{ content: 'Actualizar', onAction: loadOrders }}>
      <BlockStack gap="500">
        {error && <Banner title="Error" tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        {success && <Banner title="Exito" tone="success" onDismiss={() => setSuccess(null)}><p>{success}</p></Banner>}
        <Card padding="0">
          {orders.length === 0 ? (
            <EmptyState heading="Sin ordenes" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"><p>Las ordenes pagadas apareceran aqui.</p></EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: 'orden', plural: 'ordenes' }} itemCount={orders.length} headings={[{ title: 'Orden' }, { title: 'Cliente' }, { title: 'Total' }, { title: 'Fecha' }, { title: 'Estado' }, { title: 'Accion' }]} selectable={false}>
              {orders.map((o, i) => (
                <IndexTable.Row id={o.id} key={o.id} position={i}>
                  <IndexTable.Cell><Text fontWeight="bold">#{o.order_number}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{o.customer ? ((o.customer.first_name || '') + ' ' + (o.customer.last_name || '')).trim() : 'Consumidor Final'}</IndexTable.Cell>
                  <IndexTable.Cell>${parseFloat(o.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(o.created_at).toLocaleDateString('es-AR')}</IndexTable.Cell>
                  <IndexTable.Cell>{statusBadge(o.facturacion_status)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {o.facturacion_status === 'completed'
                      ? <Text tone="success" variant="bodySm">CAE: ...{o.cae ? o.cae.slice(-6) : ''}</Text>
                      : <Button size="slim" onClick={() => setConfirmId(o.id)} loading={invoicingId === o.id} disabled={o.facturacion_status === 'processing'}>Facturar</Button>}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
        <Modal open={!!confirmId} onClose={() => setConfirmId(null)} title="Confirmar facturacion" primaryAction={{ content: 'Generar factura', onAction: handleInvoice }} secondaryActions={[{ content: 'Cancelar', onAction: () => setConfirmId(null) }]}>
          <Modal.Section><Text>Generar factura electronica AFIP para esta orden?</Text></Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
