import { useState, useEffect, useCallback } from 'react';
import { Page, Card, IndexTable, Text, Badge, Banner, Button, BlockStack, EmptyState, SkeletonBodyText, TextField, Layout, InlineStack, Select, Icon, Pagination } from '@shopify/polaris';
import { SearchIcon, ExportIcon } from '@shopify/polaris-icons';
import { useAuthFetch } from '../hooks/useAuthFetch';

// Historial de comprobantes emitidos por la app (espejo del listado del panel de Facturante).
export default function InvoicesPage() {
  const fetch = useAuthFetch();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [pdfLoadingId, setPdfLoadingId] = useState(null);

  function buildParams(extra) {
    var params = [];
    if (status) params.push('status=' + status);
    if (from) params.push('from=' + from);
    if (to) params.push('to=' + to);
    if (q.trim()) params.push('q=' + encodeURIComponent(q.trim()));
    (extra || []).forEach(p => params.push(p));
    return params.length ? '?' + params.join('&') : '';
  }

  const load = useCallback(async (pageNum) => {
    setLoading(true); setError(null);
    try {
      var params = [];
      if (status) params.push('status=' + status);
      if (from) params.push('from=' + from);
      if (to) params.push('to=' + to);
      if (q.trim()) params.push('q=' + encodeURIComponent(q.trim()));
      params.push('page=' + (pageNum || 1));
      var d = await fetch('/api/invoices/list?' + params.join('&'));
      setInvoices(d.invoices || []);
      setPages(d.pages || 0);
      setTotal(d.total || 0);
      setPage(d.page || 1);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [fetch, status, from, to, q]);

  useEffect(() => {
    var t = setTimeout(() => load(1), q ? 400 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const handleExport = useCallback(async () => {
    setExporting(true); setError(null);
    try {
      // Descarga directa: fetch con token y blob (useAuthFetch espera JSON, aca es CSV)
      var token = await shopify.idToken();
      var res = await window.fetch('/api/invoices/list' + buildParams(['format=csv']), { headers: { 'Authorization': 'Bearer ' + token } });
      if (!res.ok) throw new Error('No se pudo exportar (HTTP ' + res.status + ')');
      var blob = await res.blob();
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'comprobantes.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setError(e.message); } finally { setExporting(false); }
  }, [status, from, to, q]);

  const handleViewPdf = useCallback(async (orderId, doc) => {
    setPdfLoadingId(orderId); setError(null);
    try {
      var d = await fetch('/api/invoices/pdf/' + orderId + (doc === 'credit_note' ? '?doc=credit_note' : ''));
      if (d.url) window.open(d.url, '_blank');
      else setError(d.error || 'PDF no disponible');
    } catch (e) { setError(e.message); } finally { setPdfLoadingId(null); }
  }, [fetch]);

  function statusBadge(s, errorMessage) {
    if (s === 'completed') return <Badge tone="success">Autorizada</Badge>;
    if (s === 'cancelled') return <Badge tone="info">Anulada (NC)</Badge>;
    if (s === 'processing') return <Badge tone="attention">Procesando</Badge>;
    if (s === 'failed') return <Badge tone="critical">Error</Badge>;
    return <Badge>Pendiente</Badge>;
  }

  if (loading && invoices.length === 0 && !error) {
    return (<Page title="Comprobantes" fullWidth><Layout><Layout.Section><Card><SkeletonBodyText lines={8} /></Card></Layout.Section></Layout></Page>);
  }

  return (
    <Page
      title="Comprobantes"
      subtitle={total ? total + ' comprobantes' : undefined}
      fullWidth
      secondaryActions={[{ content: 'Exportar CSV', icon: ExportIcon, onAction: handleExport, loading: exporting, disabled: total === 0 }]}
    >
      <BlockStack gap="500">
        {error && <Banner title="Error" tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        <Card>
          <InlineStack gap="300" blockAlign="end" wrap>
            <div style={{ minWidth: 220, flex: 1 }}>
              <TextField label="Buscar" labelHidden prefix={<Icon source={SearchIcon} tone="subdued" />} placeholder="Cliente, email, orden, CAE o numero..." value={q} onChange={setQ} clearButton onClearButtonClick={() => setQ('')} autoComplete="off" />
            </div>
            <Select
              label="Estado"
              labelHidden
              options={[
                { label: 'Todos los estados', value: '' },
                { label: 'Autorizada', value: 'completed' },
                { label: 'Procesando', value: 'processing' },
                { label: 'Anulada (NC)', value: 'cancelled' },
                { label: 'Error', value: 'failed' },
                { label: 'Pendiente', value: 'pending' },
              ]}
              value={status}
              onChange={setStatus}
            />
            <TextField label="Desde" type="date" value={from} onChange={setFrom} autoComplete="off" />
            <TextField label="Hasta" type="date" value={to} onChange={setTo} autoComplete="off" />
          </InlineStack>
        </Card>
        <Card padding="0">
          {invoices.length === 0 ? (
            <EmptyState heading="Sin comprobantes" image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png">
              <p>No hay comprobantes que coincidan con los filtros.</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: 'comprobante', plural: 'comprobantes' }}
              itemCount={invoices.length}
              headings={[{ title: 'Orden' }, { title: 'Cliente' }, { title: 'Tipo' }, { title: 'Numero' }, { title: 'CAE' }, { title: 'Total' }, { title: 'Estado' }, { title: 'Fecha' }, { title: '' }]}
              selectable={false}
            >
              {invoices.map((inv, i) => (
                <IndexTable.Row id={inv.shopifyOrderId} key={inv.shopifyOrderId} position={i}>
                  <IndexTable.Cell><Text fontWeight="bold">#{inv.shopifyOrderNumber}</Text></IndexTable.Cell>
                  <IndexTable.Cell>
                    <BlockStack gap="050">
                      <Text>{inv.customerName || '—'}</Text>
                      {inv.customerEmail && <Text variant="bodySm" tone="subdued">{inv.customerEmail}</Text>}
                    </BlockStack>
                  </IndexTable.Cell>
                  <IndexTable.Cell>{inv.tipoComprobante || '—'}</IndexTable.Cell>
                  <IndexTable.Cell>{inv.facturanteInvoiceNumber || '—'}</IndexTable.Cell>
                  <IndexTable.Cell><Text variant="bodySm">{inv.cae || '—'}</Text></IndexTable.Cell>
                  <IndexTable.Cell>${parseFloat(inv.totalAmount).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</IndexTable.Cell>
                  <IndexTable.Cell>{statusBadge(inv.status, inv.errorMessage)}</IndexTable.Cell>
                  <IndexTable.Cell>{new Date(inv.processedAt || inv.createdAt).toLocaleDateString('es-AR')}</IndexTable.Cell>
                  <IndexTable.Cell>
                    {(inv.status === 'completed' || inv.status === 'cancelled') && (
                      <Button size="slim" variant="plain" loading={pdfLoadingId === inv.shopifyOrderId} onClick={() => handleViewPdf(inv.shopifyOrderId)}>Ver PDF</Button>
                    )}
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          )}
        </Card>
        {pages > 1 && (
          <InlineStack align="center">
            <Pagination
              hasPrevious={page > 1}
              onPrevious={() => load(page - 1)}
              hasNext={page < pages}
              onNext={() => load(page + 1)}
              label={'Pagina ' + page + ' de ' + pages}
            />
          </InlineStack>
        )}
      </BlockStack>
    </Page>
  );
}
