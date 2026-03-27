import { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Layout, Card, FormLayout, TextField, Checkbox, Text, Banner, BlockStack, InlineStack, Button, Badge, SkeletonBodyText } from '@shopify/polaris';
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
    try {
      var body = { empresa: empresa.trim(), usuario: usuario.trim(), puntoVenta: puntoVenta.trim(), autoInvoice: autoInvoice };
      if (hash !== String.fromCharCode(8226).repeat(6)) body.hash = hash.trim();
      var r = await fetch('/api/settings', { method: 'POST', body: JSON.stringify(body) });
      if (r.success) {
        if (typeof shopify !== 'undefined') shopify.toast.show('Configuracion guardada');
        if (typeof shopify !== 'undefined' && shopify.saveBar) shopify.saveBar.hide('settings-bar');
        await load(); // Recargar desde DB para sincronizar estado con lo guardado
      } else setError(r.error || 'Error');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }, [fetch, load, empresa, usuario, hash, puntoVenta, autoInvoice]);

  const handleDisconnect = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', { method: 'POST', body: JSON.stringify({ empresa: '', usuario: '', hash: '', puntoVenta: '1', autoInvoice: false }) });
      setEmpresa(''); setUsuario(''); setHash(''); setPuntoVenta('1'); setAutoInvoice(false);
      orig.current = { empresa: '', usuario: '', hash: '', puntoVenta: '1', autoInvoice: false };
      if (typeof shopify !== 'undefined' && shopify.saveBar) shopify.saveBar.hide('settings-bar');
      if (typeof shopify !== 'undefined') shopify.toast.show('Desconectado');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }, [fetch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    var d = empresa !== orig.current.empresa || usuario !== orig.current.usuario || hash !== orig.current.hash || puntoVenta !== orig.current.puntoVenta || autoInvoice !== orig.current.autoInvoice;
    if (typeof shopify !== 'undefined' && shopify.saveBar) { try { d ? shopify.saveBar.show('settings-bar') : shopify.saveBar.hide('settings-bar'); } catch (e) {} }
  }, [empresa, usuario, hash, puntoVenta, autoInvoice]);

  useEffect(() => {
    if (typeof shopify === 'undefined') return;
    var bar = document.getElementById('settings-bar');
    if (!bar) {
      bar = document.createElement('ui-save-bar'); bar.id = 'settings-bar';
      var save = document.createElement('button'); save.setAttribute('variant', 'primary'); save.textContent = 'Guardar';
      save.addEventListener('click', function() { document.dispatchEvent(new Event('shopifac:save')); });
      var discard = document.createElement('button'); discard.textContent = 'Descartar';
      discard.addEventListener('click', function() { document.dispatchEvent(new Event('shopifac:discard')); });
      bar.appendChild(save); bar.appendChild(discard); document.body.appendChild(bar);
    }
    function onSave() { document.dispatchEvent(new Event('shopifac:doSave')); }
    function onDiscard() { document.dispatchEvent(new Event('shopifac:doDiscard')); }
    document.addEventListener('shopifac:save', onSave);
    document.addEventListener('shopifac:discard', onDiscard);
    return function() {
      document.removeEventListener('shopifac:save', onSave);
      document.removeEventListener('shopifac:discard', onDiscard);
      try { if (shopify.saveBar) shopify.saveBar.hide('settings-bar'); } catch (e) {}
    };
  }, []);

  useEffect(() => {
    function doSave() { handleSave(); }
    function doDiscard() {
      setEmpresa(orig.current.empresa || ''); setUsuario(orig.current.usuario || '');
      setHash(orig.current.hash || ''); setPuntoVenta(orig.current.puntoVenta || '1');
      setAutoInvoice(orig.current.autoInvoice || false); setFieldErrors({});
    }
    document.addEventListener('shopifac:doSave', doSave);
    document.addEventListener('shopifac:doDiscard', doDiscard);
    return function() { document.removeEventListener('shopifac:doSave', doSave); document.removeEventListener('shopifac:doDiscard', doDiscard); };
  }, [handleSave]);

  if (loading) return (<Page title="Configuracion" narrowWidth><Layout><Layout.Section><Card><SkeletonBodyText lines={6} /></Card></Layout.Section></Layout></Page>);

  var connected = orig.current.empresa && orig.current.hash && orig.current.hash !== String.fromCharCode(8226).repeat(6) && orig.current.hash !== '';

  return (
    <Page title="Configuracion" narrowWidth>
      <BlockStack gap="500">
        {error && <Banner title="Error" tone="critical" onDismiss={() => setError(null)}><p>{error}</p></Banner>}
        <Layout>
          <Layout.AnnotatedSection title="Credenciales de Facturante" description="Conecta tu cuenta de Facturante.com para emitir facturas electronicas.">
            <Card>
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
          </Layout.AnnotatedSection>
          <Layout.AnnotatedSection title="Facturacion automatica" description="Emitir factura automaticamente al recibir un pago.">
            <Card>
              <Checkbox label="Activar facturacion automatica" checked={autoInvoice} onChange={setAutoInvoice} helpText="Si desactivada, facturas manualmente desde Ordenes." />
            </Card>
          </Layout.AnnotatedSection>
          <Layout.AnnotatedSection title="DNI / CUIT en el checkout" description="Como configurar el campo de documento en el checkout para determinar el tipo de factura (A o B).">
            <Card>
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
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </BlockStack>
    </Page>
  );
}
