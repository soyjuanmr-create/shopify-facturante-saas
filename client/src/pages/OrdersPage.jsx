import { useState, useEffect, useCallback } from 'react';
import { Page, Card, IndexTable, Text, Badge, Banner, Button, BlockStack, EmptyState, SkeletonBodyText, Modal, TextField, Layout, InlineStack } from '@shopify/polaris';
import { useAuthFetch } from '../hooks/useAuthFetch';

export default function OrdersPage() {
  const fetch = useAuthFetch();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [invoicingId, setInvoicingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [search, setSearch] = useState('');
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });

  const loadOrders = useCallback(async (cursor) => {
    if (cursor) setLoadingMore(true); else { setLoading(true); setOrders([]); }
    setError(null);
    try {
      var url = '/api/invoices/orders' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
      var d = await fetch(url);
      setOrders(prev => cursor ? [...prev, ...(d.orders || [])] : (d.orders || []));
      setPageInfo(d.pageInfo || { hasNextPage: false, endCursor: null });
    } catch (e) { setError(e.message); } finally { setLoading(false); setLoadingMore(false); }
  }, [fetch]);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Auto-refresh while any order is processing (waiting for Facturante webhook)
  useEffect(() => {
    if (orders.some(o => o.facturacion_status === 'processing')) {
      var t = setTimeout(() => loadOrders(), 120000);
      return () => clearTimeout(t);
    }
  }, [orders, loadOrders]);

  const handleInvoice = useCallback(async () => {
    var id = confirmId; setConfirmId(null); setInvoicingId(id); setError(null); setSuccess(null);
    try {
      var d = await fetch('/api/invoices/generate', { method: 'POST', body: JSON.stringify({ orderId: id }) });
      if (d.success) { setSuccess(d.message); if (typeof shopify !== 'undefined') shopify.toast.show(d.message); loadOrders(); }
      else setError(d.error || 'Error');
    } catch (e) { setError(e.message); } finally { setInvoicingId(null); }
  }, [fetch, confirmId, loadOrders]);

  function statusBadge(o) {
    if (o.facturacion_status === 'completed') return <Badge tone="success">Facturada</Badge>;
    if (o.facturacion_status === 'processing') return <Badge tone="attention">Procesando</Badge>;
    if (o.facturacion_status === 'failed') return (
      <BlockStack gap="100">
        <Badge tone="critical">Error</Badge>
        {o.error_message && <Text variant="bodySm" tone="critical">{o.error_message.substring(0, 80)}</Text>}
      </BlockStack>
    );
    return <Badge>Pendiente</Badge>;
  }

  var filtered = orders.filter(function(o) {
    if (!search) return true;
    var q = search.toLowerCase();
    var num = (o.order_number || '').toLowerCase();
    var client = o.customer ? ((o.customer.first_name || '') + ' ' + (o.customer.last_name || '')).toLowerCase() : '';
    return num.includes(q) || client.includes(q);
  });

  if (loading) return (<Page title="Ordenes"><Layout><Layout.Section><Card><SkeletonBodyText lines={8} /></Card></Layout.Section></Layout></Page>);

  return (
    <Page title="Ordenes">
      <BlockStack gap="500">
        {error && <Banner title="Error" tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        {success && <Banner title="Exito" tone="success" onDismiss={() => setSuccess(null)}><p>{success}</p></Banner>}
        <TextField placeholder="Buscar por nro. de orden o cliente..." value={search} onChange={setSearch} clearButton onClearButtonClick={() => setSearch('')} autoComplete="off" />
        <Card padding="0">
          {filtered.length === 0 ? (
            <EmptyState heading={orders.length === 0 ? 'Sin ordenes' : 'Sin resultados'} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>{orders.length === 0 ? 'Las ordenes pagadas apareceran aqui.' : 'No hay ordenes que coincidan con la busqueda.'}</p>
            </EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: 'orden', plural: 'ordenes' }} itemCount={filtered.length} headings={[{ title: 'Orden' }, { title: 'Cliente' }, { title: 'Total' }, { title: 'Fecha' }, { title: 'Estado' }, { title: 'Accion' }]} selectable={false}>
              {filtered.map((o, i) => (
                <IndexTable.Row id={o.id} key={o.id} position={i}>
                  <IndexTable.Cell><Text fontWeight="bold">#{o.order_number}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{o.customer ? ((o.customer.first_name || '') + ' ' + (o.customer.last_name || '')).trim() : 'Consumidor Final'}</IndexTable.Cell>
                  <IndexTable.Cell>${parseFloat(o.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(o.created_at).toLocaleDateString('es-AR')}</IndexTable.Cell>
                  <IndexTable.Cell>{statusBadge(o)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {o.facturacion_status === 'completed'
                      ? <Text tone="success" variant="bodySm">CAE: ...{o.cae ? o.cae.slice(-6) : ''}</Text>
                      : <Button size="slim" variant={o.facturacion_status === 'processing' ? 'plain' : 'secondary'} onClick={() => setConfirmId(o.id)} loading={invoicingId === o.id}>
                          {o.facturacion_status === 'failed' ? 'Reintentar' : o.facturacion_status === 'processing' ? 'Reprocesar' : 'Facturar'}
                        </Button>}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
        {pageInfo.hasNextPage && !search && (
          <InlineStack align="center">
            <Button onClick={() => loadOrders(pageInfo.endCursor)} loading={loadingMore}>Ver mas ordenes</Button>
          </InlineStack>
        )}
        {(() => {
          var confirmOrder = orders.find(o => o.id === confirmId);
          var isReprocess = confirmOrder && confirmOrder.facturacion_status === 'processing';
          return (
            <Modal open={!!confirmId} onClose={() => setConfirmId(null)} title={isReprocess ? 'Reprocesar facturacion' : 'Confirmar facturacion'} primaryAction={{ content: isReprocess ? 'Reprocesar' : 'Generar factura', onAction: handleInvoice }} secondaryActions={[{ content: 'Cancelar', onAction: () => setConfirmId(null) }]}>
              <Modal.Section>
                <BlockStack gap="300">
                  <Text>Generar factura electronica via Facturante para esta orden?</Text>
                  {isReprocess && <Banner tone="warning"><p>Este comprobante fue enviado previamente. Asegurate de haber anulado el comprobante anterior en Facturante antes de continuar.</p></Banner>}
                </BlockStack>
              </Modal.Section>
            </Modal>
          );
        })()}
      </BlockStack>
    </Page>
  );
}
