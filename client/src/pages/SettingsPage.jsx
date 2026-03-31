import { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Layout, Card, FormLayout, TextField, Checkbox, Text, Banner, BlockStack, InlineStack, Button, Badge, SkeletonBodyText, InlineGrid, Box } from '@shopify/polaris';
import { useAuthFetch } from '../hooks/useAuthFetch';

export default function SettingsPage() {
  const fetch = useAuthFetch();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const [empresa, setEmpresa] = useState('');
  const [usuario, setUsuario] = useState('');
  const [hash, setHash] = useState('');
  const [puntoVenta, setPuntoVenta] = useState('1');
  const [autoInvoice, setAutoInvoice] = useState(false);
  const [isPlus, setIsPlus] = useState(false);
  const [themeLanguageUrl, setThemeLanguageUrl] = useState('');
  const orig = useRef({ empresa: '', usuario: '', hash: '', puntoVenta: '1', autoInvoice: false });
  const saveBarRef = useRef(null);
  // Refs estables para los handlers (evita re-registrar listeners en cada render)
  const handleSaveRef = useRef(null);
  const handleDiscardRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      var d = await fetch('/api/settings');
      if (d.success) {
        var v = { empresa: d.settings.empresa, usuario: d.settings.usuario, hash: d.settings.hash, puntoVenta: d.settings.puntoVenta, autoInvoice: d.autoInvoice };
        setEmpresa(v.empresa); setUsuario(v.usuario); setHash(v.hash); setPuntoVenta(v.puntoVenta); setAutoInvoice(v.autoInvoice);
        setIsPlus(!!d.isPlus);
        if (d.shopDomain) {
          var slug = d.shopDomain.replace('.myshopify.com', '');
          var url = d.themeId
            ? 'https://admin.shopify.com/store/' + slug + '/themes/' + d.themeId + '/language?query=empresa'
            : 'https://admin.shopify.com/store/' + slug + '/themes';
          setThemeLanguageUrl(url);
        }
        orig.current = v;
      }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [fetch]);

  function validate() {
    var e = {};
    if (!empresa.trim()) e.empresa = 'Obligatorio';
    if (!usuario.trim()) e.usuario = 'Obligatorio';
    else if (usuario.indexOf('@') === -1) e.usuario = 'Email invalido';
    if (!hash.trim() && hash !== String.fromCharCode(8226).repeat(6)) e.hash = 'Obligatorio';
    setFieldErrors(e); return Object.keys(e).length === 0;
  }

  const handleSave = useCallback(async () => {
    if (!validate()) return;
    setSaving(true); setError(null);
    if (typeof shopify !== 'undefined') shopify.loading.start();
    try {
      var body = { empresa: empresa.trim(), usuario: usuario.trim(), puntoVenta: puntoVenta.trim(), autoInvoice: autoInvoice };
      if (hash !== String.fromCharCode(8226).repeat(6)) body.hash = hash.trim();
      var r = await fetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
      if (r.success) {
        if (typeof shopify !== 'undefined') shopify.toast.show('Configuracion guardada');
        if (saveBarRef.current) saveBarRef.current.hide().catch(function() {});
        await load(); // Recargar desde DB para sincronizar estado con lo guardado
      } else setError(r.error || 'Error');
    } catch (e) { setError(e.message); } finally { setSaving(false); if (typeof shopify !== 'undefined') shopify.loading.stop(); }
  }, [fetch, load, empresa, usuario, hash, puntoVenta, autoInvoice]);

  const handleDisconnect = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', { method: 'POST', body: JSON.stringify({ empresa: '', usuario: '', hash: '', puntoVenta: '1', autoInvoice: false }) });
      setEmpresa(''); setUsuario(''); setHash(''); setPuntoVenta('1'); setAutoInvoice(false);
      orig.current = { empresa: '', usuario: '', hash: '', puntoVenta: '1', autoInvoice: false };
      if (saveBarRef.current) saveBarRef.current.hide().catch(function() {});
      if (typeof shopify !== 'undefined') shopify.toast.show('Desconectado');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }, [fetch]);

  // Mantener refs actualizados con los handlers más recientes
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);
  const handleDiscard = useCallback(() => {
    setEmpresa(orig.current.empresa || ''); setUsuario(orig.current.usuario || ''); setHash(orig.current.hash || '');
    setPuntoVenta(orig.current.puntoVenta || '1'); setAutoInvoice(orig.current.autoInvoice || false); setFieldErrors({});
  }, []);
  useEffect(() => { handleDiscardRef.current = handleDiscard; }, [handleDiscard]);

  // Registrar listeners nativos en los botones del ui-save-bar (Shadow DOM no propaga eventos React)
  useEffect(() => {
    var bar = saveBarRef.current;
    if (!bar) return;
    var saveBtn = bar.querySelector('button[variant="primary"]');
    var discardBtn = bar.querySelector('button:not([variant])');
    function onSave() { if (handleSaveRef.current) handleSaveRef.current(); }
    function onDiscard() { if (handleDiscardRef.current) handleDiscardRef.current(); }
    if (saveBtn) saveBtn.addEventListener('click', onSave);
    if (discardBtn) discardBtn.addEventListener('click', onDiscard);
    return function() {
      if (saveBtn) saveBtn.removeEventListener('click', onSave);
      if (discardBtn) discardBtn.removeEventListener('click', onDiscard);
    };
  }, [loading]); // Re-registrar cuando el componente termina de cargar

  useEffect(() => { load(); }, [load]);

  // Dirty check → show/hide via ref al elemento nativo
  useEffect(() => {
    var d = empresa !== orig.current.empresa || usuario !== orig.current.usuario || hash !== orig.current.hash || puntoVenta !== orig.current.puntoVenta || autoInvoice !== orig.current.autoInvoice;
    var bar = saveBarRef.current;
    if (bar) {
      var timer = setTimeout(function() {
        var p = d ? bar.show() : bar.hide();
        if (p && p.catch) p.catch(function() {});
      }, 50);
      return function() { clearTimeout(timer); };
    }
  }, [empresa, usuario, hash, puntoVenta, autoInvoice]);

  if (loading) return (<Page title="Configuracion" fullWidth><Layout><Layout.Section><Card roundedAbove="sm" padding="400"><SkeletonBodyText lines={6} /></Card></Layout.Section></Layout></Page>);

  var connected = orig.current.empresa && orig.current.hash && orig.current.hash !== String.fromCharCode(8226).repeat(6) && orig.current.hash !== '';

  return (
    <Page title="Configuracion" fullWidth>
      <ui-save-bar id="settings-bar" ref={saveBarRef}>
        <button variant="primary">Guardar</button>
        <button>Descartar</button>
      </ui-save-bar>
      <BlockStack gap="500">
        {error && <Banner title="Error" tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        <BlockStack gap={{ xs: '800', sm: '400' }}>
          
          <InlineGrid columns={{ xs: 1, md: '2fr 5fr' }} gap="400">
            <Box as="section" paddingInlineStart={{ xs: 400, sm: 0 }} paddingInlineEnd={{ xs: 400, sm: 0 }}>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Credenciales de Facturante</Text>
                <Text as="p" tone="subdued">Conecta tu cuenta de Facturante.com para emitir facturas electronicas.</Text>
              </BlockStack>
            </Box>
            <Card roundedAbove="sm" padding="400">
              <BlockStack gap="400">
                {connected && <InlineStack align="space-between"><Badge tone="success">Conectado</Badge><Button variant="plain" tone="critical" onClick={handleDisconnect} loading={saving}>Desconectar</Button></InlineStack>}
                <FormLayout>
                  <TextField label="Nro de empresa" value={empresa} onChange={v => { setEmpresa(v); setFieldErrors(p => ({...p, empresa: undefined})); }} error={fieldErrors.empresa} autoComplete="off" helpText="Numero asignado por Facturante" />
                  <TextField label="Usuario" type="email" value={usuario} onChange={v => { setUsuario(v); setFieldErrors(p => ({...p, usuario: undefined})); }} error={fieldErrors.usuario} autoComplete="email" helpText="Email de Facturante.com" />
                  <TextField label="API Hash" type="password" value={hash} onChange={v => { setHash(v); setFieldErrors(p => ({...p, hash: undefined})); }} error={fieldErrors.hash} autoComplete="off" />
                  <TextField label="Punto de venta" value={puntoVenta} onChange={v => setPuntoVenta(v)} autoComplete="off" helpText="Nro habilitado en Facturante" />
                </FormLayout>
              </BlockStack>
            </Card>
          </InlineGrid>
          
          <InlineGrid columns={{ xs: 1, md: '2fr 5fr' }} gap="400">
            <Box as="section" paddingInlineStart={{ xs: 400, sm: 0 }} paddingInlineEnd={{ xs: 400, sm: 0 }}>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">Facturacion automatica</Text>
                <Text as="p" tone="subdued">Emitir factura automaticamente al recibir un pago.</Text>
              </BlockStack>
            </Box>
            <Card roundedAbove="sm" padding="400">
              <BlockStack gap="400">
                <Checkbox label="Activar facturacion automatica" checked={autoInvoice} onChange={setAutoInvoice} helpText="Si desactivada, facturas manualmente desde Ordenes." />
              </BlockStack>
            </Card>
          </InlineGrid>

          <InlineGrid columns={{ xs: 1, md: '2fr 5fr' }} gap="400">
            <Box as="section" paddingInlineStart={{ xs: 400, sm: 0 }} paddingInlineEnd={{ xs: 400, sm: 0 }}>
              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">DNI / CUIT en el checkout</Text>
                <Text as="p" tone="subdued">Como configurar el campo de documento en el checkout para determinar el tipo de factura (A o B).</Text>
              </BlockStack>
            </Box>
            <Card roundedAbove="sm" padding="400">
              <BlockStack gap="400">
                {isPlus ? (
                  <BlockStack gap="200">
                    <Text>Tu tienda es Shopify Plus. El campo DNI / CUIT aparece automaticamente en el checkout via la extension de Shopifac.</Text>
                    <Banner tone="success"><p>No necesitas hacer nada adicional.</p></Banner>
                  </BlockStack>
                ) : (
                  <BlockStack gap="400">
                    <Text>Para que el cliente ingrese su DNI o CUIT, edita el contenido predeterminado del tema y renombra el campo <Text as="span" fontWeight="bold">Empresa</Text> a <Text as="span" fontWeight="bold">DNI / CUIT</Text>.</Text>
                    <Text tone="subdued">Anda a Tienda online &gt; Temas &gt; ... &gt; Editar contenido predeterminado del tema, busca "Empresa" y reemplazalo por "DNI / CUIT".</Text>
                    <Button onClick={() => window.open(themeLanguageUrl, '_top')} disabled={!themeLanguageUrl}>
                      Editar contenido del tema
                    </Button>
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </InlineGrid>

        </BlockStack>
      </BlockStack>
    </Page>
  );
}
