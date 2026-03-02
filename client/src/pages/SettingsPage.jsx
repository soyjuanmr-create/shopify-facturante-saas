import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Page, Layout, Card, FormLayout, TextField, Checkbox, Text, Banner, BlockStack, InlineStack, Button, Badge, SkeletonBodyText } from '@shopify/polaris';
import { useAuthFetch } from '../hooks/useAuthFetch';

export default function SettingsPage() {
  const fetch = useAuthFetch();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [dirty, setDirty] = useState(false);
  const [empresa, setEmpresa] = useState('');
  const [usuario, setUsuario] = useState('');
  const [hash, setHash] = useState('');
  const [puntoVenta, setPuntoVenta] = useState('1');
  const [autoInvoice, setAutoInvoice] = useState(false);
  const orig = useRef({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      var d = await fetch('/api/settings');
      if (d.success) {
        var v = { empresa: d.settings.empresa, usuario: d.settings.usuario, hash: d.settings.hash, puntoVenta: d.settings.puntoVenta, autoInvoice: d.autoInvoice };
        setEmpresa(v.empresa); setUsuario(v.usuario); setHash(v.hash); setPuntoVenta(v.puntoVenta); setAutoInvoice(v.autoInvoice);
        orig.current = v;
      }
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [fetch]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    var d = empresa !== orig.current.empresa || usuario !== orig.current.usuario || hash !== orig.current.hash || puntoVenta !== orig.current.puntoVenta || autoInvoice !== orig.current.autoInvoice;
    setDirty(d);
    if (typeof shopify !== 'undefined' && shopify.saveBar) { d ? shopify.saveBar.show('settings-bar') : shopify.saveBar.hide('settings-bar'); }
  }, [empresa, usuario, hash, puntoVenta, autoInvoice]);

  useEffect(() => {
    if (typeof shopify === 'undefined') return;
    var bar = document.getElementById('settings-bar');
    if (!bar) {
      bar = document.createElement('s-save-bar'); bar.id = 'settings-bar';
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
    return function() { document.removeEventListener('shopifac:save', onSave); document.removeEventListener('shopifac:discard', onDiscard); };
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
  });

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
        orig.current = { empresa: body.empresa, usuario: body.usuario, hash: hash, puntoVenta: body.puntoVenta, autoInvoice: autoInvoice };
        setDirty(false); if (typeof shopify !== 'undefined') shopify.toast.show('Configuracion guardada');
      } else setError(r.error || 'Error');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }, [fetch, empresa, usuario, hash, puntoVenta, autoInvoice]);

  const handleDisconnect = useCallback(async () => {
    setSaving(true);
    try {
      await fetch('/api/settings', { method: 'POST', body: JSON.stringify({ empresa: '', usuario: '', hash: '', puntoVenta: '1', autoInvoice: false }) });
      setEmpresa(''); setUsuario(''); setHash(''); setPuntoVenta('1'); setAutoInvoice(false);
      orig.current = { empresa: '', usuario: '', hash: '', puntoVenta: '1', autoInvoice: false };
      if (typeof shopify !== 'undefined') shopify.toast.show('Desconectado');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }, [fetch]);

  if (loading) return (<Page title="Configuracion"><Layout><Layout.Section><Card><SkeletonBodyText lines={6} /></Card></Layout.Section></Layout></Page>);

  var connected = orig.current.empresa && orig.current.hash && orig.current.hash !== String.fromCharCode(8226).repeat(6) && orig.current.hash !== '';

  return (
    <Page title="Configuracion">
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
                  <TextField label="Punto de venta" value={puntoVenta} onChange={v => setPuntoVenta(v)} autoComplete="off" helpText="Nro habilitado en AFIP" />
                </FormLayout>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
          <Layout.AnnotatedSection title="Facturacion automatica" description="Emitir factura automaticamente al recibir un pago.">
            <Card>
              <Checkbox label="Activar facturacion automatica" checked={autoInvoice} onChange={setAutoInvoice} helpText="Si desactivada, facturas manualmente desde Ordenes." />
            </Card>
          </Layout.AnnotatedSection>
          <Layout.AnnotatedSection title="Tipo de factura" description="Determinacion automatica de Factura A o B.">
            <Card>
              <BlockStack gap="200">
                <Text>Por defecto se emite Factura B. Si el cliente ingresa un CUIT valido, se emite Factura A.</Text>
                <Banner tone="info"><p>Habilita el campo Empresa en Configuracion - Checkout y renombralo como CUIT / DNI.</p></Banner>
              </BlockStack>
            </Card>
          </Layout.AnnotatedSection>
        </Layout>
      </BlockStack>
    </Page>
  );
}
