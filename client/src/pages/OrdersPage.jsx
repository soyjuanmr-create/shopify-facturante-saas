import { useState, useEffect, useCallback } from 'react';
import { Page, Card, IndexTable, Text, Badge, Banner, Button, BlockStack, EmptyState, SkeletonBodyText, Modal, TextField, Layout, InlineStack, Popover, ActionList, Icon, ChoiceList, Select, Checkbox } from '@shopify/polaris';
import { MenuHorizontalIcon, SearchIcon } from '@shopify/polaris-icons';
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
  const [tipoComp, setTipoComp] = useState('auto');
  const [creditId, setCreditId] = useState(null);
  const [creditingId, setCreditingId] = useState(null);
  const [ncMode, setNcMode] = useState(['total']);
  const [ncInfo, setNcInfo] = useState(null);
  const [ncSelection, setNcSelection] = useState({});
  const [ncAmount, setNcAmount] = useState('');
  const [ncError, setNcError] = useState(null);
  const [resendId, setResendId] = useState(null);
  const [resendEmails, setResendEmails] = useState('');
  const [resending, setResending] = useState(false);
  const [pdfLoadingId, setPdfLoadingId] = useState(null);
  const [activeMenu, setActiveMenu] = useState(null);
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
    var id = confirmId; var tipo = tipoComp;
    setConfirmId(null); setInvoicingId(id); setError(null); setSuccess(null);
    try {
      var body = { orderId: id };
      if (tipo === 'FA' || tipo === 'FB') body.tipoComprobante = tipo;
      var d = await fetch('/api/invoices/generate', { method: 'POST', body: JSON.stringify(body) });
      if (d.success) { setSuccess(d.message); if (typeof shopify !== 'undefined') shopify.toast.show(d.message); loadOrders(null, search.trim()); }
      else setError(d.error || 'Error');
    } catch (e) { setError(e.message); } finally { setInvoicingId(null); }
  }, [fetch, confirmId, tipoComp, loadOrders, search]);

  const openCreditModal = useCallback(async (orderId) => {
    setNcMode(['total']); setNcSelection({}); setNcAmount(''); setNcInfo(null); setNcError(null);
    setCreditId(orderId);
    try {
      var info = await fetch('/api/invoices/credit-note-info/' + orderId);
      setNcInfo(info);
    } catch (e) { setNcInfo({ partialAvailable: false, items: [] }); }
  }, [fetch]);

  const handleCreditNote = useCallback(async () => {
    var id = creditId; var mode = ncMode[0];
    var body = { orderId: id };
    setNcError(null);
    if (mode === 'items') {
      body.mode = 'partial';
      var seleccionados = Object.keys(ncSelection).filter(idx => ncSelection[idx] && ncSelection[idx].checked);
      // Un item marcado con cantidad vacia/invalida es un error, no se descarta en silencio
      var invalido = seleccionados.find(idx => !(parseFloat(ncSelection[idx].cantidad) > 0));
      if (invalido !== undefined) { setNcError('Revisa la cantidad de los items seleccionados: debe ser mayor a 0.'); return; }
      body.items = seleccionados.map(idx => ({ index: parseInt(idx, 10), cantidad: parseFloat(ncSelection[idx].cantidad) }));
      if (body.items.length === 0) { setNcError('Selecciona al menos un item para acreditar.'); return; }
    } else if (mode === 'amount') {
      body.mode = 'partial';
      body.amount = parseFloat(ncAmount);
      if (!(body.amount > 0)) { setNcError('Indica un monto valido.'); return; }
    }
    setCreditId(null); setCreditingId(id); setError(null); setSuccess(null);
    try {
      var d = await fetch('/api/invoices/credit-note', { method: 'POST', body: JSON.stringify(body) });
      if (d.success) { setSuccess(d.message); if (typeof shopify !== 'undefined') shopify.toast.show(d.message); loadOrders(null, search.trim()); }
      else setError(d.error || 'Error');
    } catch (e) { setError(e.message); } finally { setCreditingId(null); }
  }, [fetch, creditId, ncMode, ncSelection, ncAmount, loadOrders, search]);

  const handleViewPdf = useCallback(async (orderId, doc) => {
    setPdfLoadingId(orderId); setError(null);
    try {
      var d = await fetch('/api/invoices/pdf/' + orderId + (doc === 'credit_note' ? '?doc=credit_note' : ''));
      if (d.url) window.open(d.url, '_blank');
      else setError(d.error || 'PDF no disponible');
    } catch (e) { setError(e.message); } finally { setPdfLoadingId(null); }
  }, [fetch]);

  const handleResend = useCallback(async () => {
    var id = resendId; var emails = resendEmails.trim();
    setResending(true); setError(null); setSuccess(null);
    try {
      var d = await fetch('/api/invoices/resend-email', { method: 'POST', body: JSON.stringify({ orderId: id, emails: emails }) });
      if (d.success) { setResendId(null); setResendEmails(''); setSuccess(d.message); if (typeof shopify !== 'undefined') shopify.toast.show(d.message); }
      else setError(d.error || 'Error');
    } catch (e) { setError(e.message); } finally { setResending(false); }
  }, [fetch, resendId, resendEmails]);

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

  function rowMenu(o) {
    var busy = creditingId === o.id || pdfLoadingId === o.id;
    var items = [{ content: 'Ver factura (PDF)', onAction: () => { setActiveMenu(null); handleViewPdf(o.id); } }];
    if (o.facturacion_status === 'completed') {
      items.push({ content: 'Reenviar por email', onAction: () => { setActiveMenu(null); setResendEmails(''); setResendId(o.id); } });
      items.push({ content: 'Emitir nota de credito', destructive: true, onAction: () => { setActiveMenu(null); openCreditModal(o.id); } });
    }
    if (o.facturacion_status === 'cancelled') {
      items.push({ content: 'Ver nota de credito (PDF)', onAction: () => { setActiveMenu(null); handleViewPdf(o.id, 'credit_note'); } });
    }
    return (
      <Popover
        active={activeMenu === o.id}
        onClose={() => setActiveMenu(null)}
        activator={<Button variant="tertiary" icon={MenuHorizontalIcon} accessibilityLabel="Mas acciones" loading={busy} onClick={() => setActiveMenu(activeMenu === o.id ? null : o.id)} />}
      >
        <ActionList actionRole="menuitem" items={items} />
      </Popover>
    );
  }

  if (loading) return (<Page title="Ordenes" fullWidth><Layout><Layout.Section><Card><SkeletonBodyText lines={8} /></Card></Layout.Section></Layout></Page>);

  return (
    <Page title="Ordenes" fullWidth>
      <BlockStack gap="500">
        {error && <Banner title="Error" tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        {success && <Banner title="Exito" tone="success" onDismiss={() => setSuccess(null)}><p>{success}</p></Banner>}
        <TextField label="Buscar ordenes" labelHidden prefix={<Icon source={SearchIcon} tone="subdued" />} placeholder="Buscar por nro. de orden, cliente o email..." value={search} onChange={setSearch} clearButton onClearButtonClick={() => setSearch('')} autoComplete="off" />
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
                      ? <InlineStack gap="200" blockAlign="center" align="space-between" wrap={false}>
                          <Text tone="subdued" variant="bodySm">CAE …{o.cae ? o.cae.slice(-6) : ''}</Text>
                          {rowMenu(o)}
                        </InlineStack>
                      : o.facturacion_status === 'cancelled'
                        ? <InlineStack gap="200" blockAlign="center" align="space-between" wrap={false}>
                            <Text tone="subdued" variant="bodySm">Nota de credito emitida</Text>
                            {rowMenu(o)}
                          </InlineStack>
                      : o.facturacion_status === 'processing'
                        ? <InlineStack gap="200">
                          <Button size="slim" onClick={() => handleSyncStatus(o.id)} loading={syncingId === o.id}>Verificar estado</Button>
                          <Button size="slim" variant="plain" tone="critical" onClick={() => { setTipoComp('auto'); setConfirmId(o.id); }} loading={invoicingId === o.id}>Reprocesar</Button>
                        </InlineStack>
                        : <Button size="slim" variant="primary" onClick={() => { setTipoComp('auto'); setConfirmId(o.id); }} loading={invoicingId === o.id}>
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
                  <Select
                    label="Tipo de comprobante"
                    options={[
                      { label: 'Automatico (segun CUIT/DNI del cliente)', value: 'auto' },
                      { label: 'Factura A (forzar)', value: 'FA' },
                      { label: 'Factura B (forzar)', value: 'FB' },
                    ]}
                    value={tipoComp}
                    onChange={setTipoComp}
                    helpText="Para Factura A el cliente debe tener un CUIT valido como responsable inscripto."
                  />
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
          var mode = ncMode[0];
          return (
            <Modal open={!!creditId} onClose={() => setCreditId(null)} title="Emitir nota de credito" primaryAction={{ content: 'Emitir nota de credito', destructive: true, onAction: handleCreditNote }} secondaryActions={[{ content: 'Cancelar', onAction: () => setCreditId(null) }]}>
              <Modal.Section>
                <BlockStack gap="300">
                  {ncError && <Banner tone="critical" onDismiss={() => setNcError(null)}><p>{ncError}</p></Banner>}
                  <Text>Nota de credito sobre la factura {creditOrder ? 'de la orden #' + creditOrder.order_number : ''}.</Text>
                  <ChoiceList
                    title="Alcance"
                    choices={[
                      { label: 'Total — anula la factura completa', value: 'total' },
                      { label: 'Parcial por items', value: 'items', disabled: !(ncInfo && ncInfo.partialAvailable), helpText: ncInfo && !ncInfo.partialAvailable ? 'No disponible: faltan datos del comprobante original.' : undefined },
                      { label: 'Parcial por monto', value: 'amount', disabled: !(ncInfo && ncInfo.partialAvailable) },
                    ]}
                    selected={ncMode}
                    onChange={setNcMode}
                  />
                  {mode === 'items' && ncInfo && (
                    <BlockStack gap="200">
                      {ncInfo.items.map(it => {
                        var sel = ncSelection[it.index] || { checked: false, cantidad: String(it.cantidad) };
                        return (
                          <InlineStack key={it.index} gap="300" blockAlign="center" wrap={false}>
                            <div style={{ flex: 1 }}>
                              <Checkbox
                                label={it.descripcion}
                                checked={sel.checked}
                                onChange={(checked) => setNcSelection({ ...ncSelection, [it.index]: { ...sel, checked } })}
                              />
                            </div>
                            <div style={{ width: 90 }}>
                              <TextField
                                label="Cantidad"
                                labelHidden
                                type="number"
                                min={1}
                                max={it.cantidad}
                                disabled={!sel.checked}
                                value={sel.cantidad}
                                onChange={(v) => setNcSelection({ ...ncSelection, [it.index]: { ...sel, cantidad: v } })}
                                suffix={'/ ' + it.cantidad}
                                autoComplete="off"
                              />
                            </div>
                          </InlineStack>
                        );
                      })}
                    </BlockStack>
                  )}
                  {mode === 'amount' && (
                    <TextField
                      label="Monto a acreditar (IVA incluido)"
                      type="number"
                      prefix="$"
                      value={ncAmount}
                      onChange={setNcAmount}
                      helpText="Se emite una NC por este importe final, asociada a la factura original."
                      autoComplete="off"
                    />
                  )}
                  <Banner tone="warning"><p>Esta accion genera un comprobante legal ante AFIP/ARCA y <strong>no se puede deshacer</strong>.{mode === 'total' ? ' La factura quedara anulada por el total.' : ' La factura original sigue vigente; la NC descuenta el importe acreditado.'}</p></Banner>
                </BlockStack>
              </Modal.Section>
            </Modal>
          );
        })()}
        <Modal open={!!resendId} onClose={() => setResendId(null)} title="Reenviar comprobante por email" primaryAction={{ content: 'Reenviar', onAction: handleResend, loading: resending }} secondaryActions={[{ content: 'Cancelar', onAction: () => setResendId(null) }]}>
          <Modal.Section>
            <BlockStack gap="300">
              <Text>Facturante reenviara el comprobante en PDF por email.</Text>
              <TextField
                label="Direcciones de envio (opcional)"
                placeholder="ejemplo@mail.com, otro@mail.com"
                value={resendEmails}
                onChange={setResendEmails}
                helpText="Si lo dejas vacio, se reenvia al email de facturacion del cliente."
                autoComplete="off"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
