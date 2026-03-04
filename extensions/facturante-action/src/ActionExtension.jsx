import { useState } from "preact/hooks";

export default function ActionExt() {
  var i18n = shopify.i18n;
  var data = shopify.data;
  var close = shopify.close;
  var [loading, setLoading] = useState(false);
  var [result, setResult] = useState(null);
  var [error, setError] = useState(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      var token = await shopify.idToken();
      var shortId = data.selected[0].id.split("/").pop();
      var r = await fetch("/api/invoices/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ orderId: shortId }),
      });
      var d = await r.json();
      if (d.success) setResult(d.message || i18n.translate("success"));
      else setError(d.error || i18n.translate("error"));
    } catch (e) { setError(i18n.translate("error")); }
    setLoading(false);
  }

  if (result) return (
    <s-admin-action>
      <s-banner status="success"><s-text>{result}</s-text></s-banner>
      <s-button slot="primaryAction" onClick={() => close()}>Cerrar</s-button>
    </s-admin-action>
  );

  return (
    <s-admin-action>
      <s-stack direction="block">
        <s-text>{i18n.translate("description")}</s-text>
        {error && <s-banner status="critical"><s-text>{error}</s-text></s-banner>}
      </s-stack>
      <s-button slot="primaryAction" onClick={generate} loading={loading} disabled={loading}>
        {loading ? i18n.translate("generating") : i18n.translate("generate")}
      </s-button>
      <s-button slot="secondaryAction" onClick={() => close()} disabled={loading}>{i18n.translate("cancel")}</s-button>
    </s-admin-action>
  );
}
