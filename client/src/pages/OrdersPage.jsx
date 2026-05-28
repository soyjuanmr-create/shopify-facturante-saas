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
  const [syncingId, setSyncingId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const [creditId, setCreditId] = useState(null);
  const [creditingId, setCreditingId] = useState(null);
  const [search, setSearch] = useState('');
  const [pageInfo, setPageInfo] = useState({ hasNextPage: false, endCursor: null });

  const loadOrders = useCallback(async (cursor, searchTerm) => {
    if (cursor) setLoadingMore(true); else { setLoading(true); setOrders([]); }
    setError(null);
    try {
      var params = [];
      if (cursor) params.push('cursor=' + encodeURIComponent(cursor));
      if (searchTerm) params.push('search=' + encodeURIComponent(searchTerm));
      var url = '/api/invoices/orders' + (params.length ? '?' + params.join('&') : '');
      var d = await fetch(url);
      setOrders(prev => cursor ? [...prev, ...(d.orders || [])] : (d.orders || []));
      setPageInfo(d.pageInfo || { hasNextPage: false, endCursor: null });
    } catch (e) { setError(e.message); } finally { setLoading(false); setLoadingMore(false); }
  }, [fetch]);

  // Carga inicial + busqueda server-side con debounce (consulta Shopify, no filtra en memoria)
  useEffect(() => {
    var t = setTimeout(() => loadOrders(null, search.trim()), search ? 400 : 0);
    return () => clearTimeout(t);
  }, [search, loadOrders]);

  // Auto-refresh mientras alguna orden esta en procesando (esperando webhook de Facturante)
  useEffect(() => {
    if (orders.some(o => o.facturacion_status === 'processing')) {
      var t = setTimeout(() => loadOrders(null, search.trim()), 30000);
      return () => clearTimeout(t);
    }
  }, [orders, loadOrders, search]);

  const handleInvoice = useCallback(async () => {
    var id = confirmId; setConfirmId(null); setInvoicingId(id); setError(null); setSuccess(null);
    try {
      var d = await fetch('/api/invoices/generate', { method: 'POST', body: JSON.stringify({ orderId: id }) });
      if (d.success) { setSuccess(d.message); if (typeof shopify !== 'undefined') shopify.toast.show(d.message); loadOrders(null, search.trim()); }
      else setError(d.error || 'Error');
    } catch (e) { setError(e.message); } finally { setInvoicingId(null); }
  }, [fetch, confirmId, loadOrders, search]);

  const handleCreditNote = useCallback(async () => {
    var id = creditId; setCreditId(null); setCreditingId(id); setError(null); setSuccess(null);
    try {
      var d = await fetch('/api/invoices/credit-note', { method: 'POST', body: JSON.stringify({ orderId: id }) });
      if (d.success) { setSuccess(d.message); if (typeof shopify !== 'undefined') shopify.toast.show(d.message); loadOrders(null, search.trim()); }
      else setError(d.error || 'Error');
    } catch (e) { setError(e.message); } finally { setCreditingId(null); }
  }, [fetch, creditId, loadOrders, search]);

  const handleSyncStatus = useCallback(async (orderId) => {
    setSyncingId(orderId); setError(null); setSuccess(null);
    try {
      var d = await fetch('/api/invoices/sync-status/' + orderId, { method: 'POST' });
      if (d.status === 'completed') {
        setSuccess('Factura autorizada. CAE: ' + d.cae);
        if (typeof shopify !== 'undefined') shopify.toast.show('Factura autorizada correctamente');
        loadOrders(null, search.trim());
      } else if (d.status === 'failed') {
        setError('Facturante rechazó el comprobante: ' + (d.message || ''));
        loadOrders(null, search.trim());
      } else if (d.error) {
        // El servidor devolvio un error con mensaje descriptivo (400, 404, 502, 500)
        setError(d.error + (d.tip ? ' — ' + d.tip : ''));
      } else {
        if (typeof shopify !== 'undefined') shopify.toast.show('Aun en proceso en Facturante. Estado: ' + (d.facturanteEstado || 'procesando'));
      }
    } catch (e) {
      // useAuthFetch lanza el error como texto del servidor si esta disponible
      setError('Error al verificar estado: ' + e.message);
    } finally { setSyncingId(null); }
  }, [fetch, loadOrders, search]);

  function statusBadge(o) {
    if (o.facturacion_status === 'completed') return <Badge tone="success">Facturada</Badge>;
    if (o.facturacion_status === 'cancelled') return <Badge tone="info">Anulada (NC)</Badge>;
    if (o.facturacion_status === 'processing') return <Badge tone="attention">Procesando</Badge>;
    if (o.facturacion_status === 'failed') return (
      <BlockStack gap="100">
        <Badge tone="critical">Error</Badge>
        {o.error_message && <Text variant="bodySm" tone="critical">{o.error_message.substring(0, 80)}</Text>}
      </BlockStack>
    );
    return <Badge>Pendiente</Badge>;
  }

  if (loading) return (<Page title="Ordenes" fullWidth><Layout><Layout.Section><Card><SkeletonBodyText lines={8} /></Card></Layout.Section></Layout></Page>);

  return (
    <Page title="Ordenes" fullWidth>
      <BlockStack gap="500">
        {error && <Banner title="Error" tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        {success && <Banner title="Exito" tone="success" onDismiss={() => setSuccess(null)}><p>{success}</p></Banner>}
        <TextField placeholder="Buscar por nro. de orden o cliente..." value={search} onChange={setSearch} clearButton onClearButtonClick={() => setSearch('')} autoComplete="off" />
        <Card padding="0">
          {orders.length === 0 ? (
            <EmptyState heading={search ? 'Sin resultados' : 'Sin ordenes'} image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>{search ? 'No hay ordenes que coincidan con la busqueda.' : 'Las ordenes pagadas apareceran aqui.'}</p>
            </EmptyState>
          ) : (
            <IndexTable resourceName={{ singular: 'orden', plural: 'ordenes' }} itemCount={orders.length} headings={[{ title: 'Orden' }, { title: 'Cliente' }, { title: 'Total' }, { title: 'Fecha' }, { title: 'Estado' }, { title: 'Accion' }]} selectable={false}>
              {orders.map((o, i) => (
                <IndexTable.Row id={o.id} key={o.id} position={i}>
                  <IndexTable.Cell><Text fontWeight="bold">#{o.order_number}</Text></IndexTable.Cell>
                  <IndexTable.Cell>{o.customer ? ((o.customer.first_name || '') + ' ' + (o.customer.last_name || '')).trim() || 'Cliente' : '—'}</IndexTable.Cell>
                  <IndexTable.Cell>${parseFloat(o.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(o.created_at).toLocaleDateString('es-AR')}</IndexTable.Cell>
                  <IndexTable.Cell>{statusBadge(o)}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {o.facturacion_status === 'completed'
                      ? <BlockStack gap="100">
                          <Text tone="success" variant="bodySm">CAE: ...{o.cae ? o.cae.slice(-6) : ''}</Text>
                          <Button size="slim" variant="plain" tone="critical" onClick={() => setCreditId(o.id)} loading={creditingId === o.id}>Nota de credito</Button>
                        </BlockStack>
                      : o.facturacion_status === 'cancelled'
                        ? <Text tone="subdued" variant="bodySm">NC emitida</Text>
                      : o.facturacion_status === 'processing'
                        ? <BlockStack gap="100">
                          <Button size="slim" variant="plain" onClick={() => handleSyncStatus(o.id)} loading={syncingId === o.id}>Verificar estado</Button>
                          <Button size="slim" variant="plain" tone="critical" onClick={() => setConfirmId(o.id)} loading={invoicingId === o.id}>Reprocesar</Button>
                        </BlockStack>
                        : <Button size="slim" variant="secondary" onClick={() => setConfirmId(o.id)} loading={invoicingId === o.id}>
                          {o.facturacion_status === 'failed' ? 'Reintentar' : 'Facturar'}
                        </Button>}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
        {pageInfo.hasNextPage && (
          <InlineStack align="center">
            <Button onClick={() => loadOrders(pageInfo.endCursor, search.trim())} loading={loadingMore}>Ver mas ordenes</Button>
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
                  {confirmOrder && confirmOrder.facturacion_status === 'failed' && (
                    <Banner tone="warning">
                      <p>Si el error fue por falta de documento: asegurate de que el cliente haya ingresado su DNI o CUIT en el checkout. Para ordenes existentes, podes editarlas en Shopify y agregar el atributo <strong>documento_identidad</strong> manualmente.</p>
                    </Banner>
                  )}
                  {isReprocess && <Banner tone="warning"><p>Este comprobante fue enviado previamente. Asegurate de haber anulado el comprobante anterior en Facturante antes de continuar.</p></Banner>}
                </BlockStack>
              </Modal.Section>
            </Modal>
          );
        })()}
        {(() => {
          var creditOrder = orders.find(o => o.id === creditId);
          return (
            <Modal open={!!creditId} onClose={() => setCreditId(null)} title="Emitir nota de credito" primaryAction={{ content: 'Emitir nota de credito', destructive: true, onAction: handleCreditNote }} secondaryActions={[{ content: 'Cancelar', onAction: () => setCreditId(null) }]}>
              <Modal.Section>
                <BlockStack gap="300">
                  <Text>Se emitira una nota de credito que anula la factura {creditOrder ? 'de la orden #' + creditOrder.order_number : ''} por el total.</Text>
                  <Banner tone="warning"><p>Esta accion genera un comprobante legal ante AFIP/ARCA y <strong>no se puede deshacer</strong>. Confirma solo si necesitas anular la factura completa.</p></Banner>
                </BlockStack>
              </Modal.Section>
            </Modal>
          );
        })()}
      </BlockStack>
    </Page>
  );
}
