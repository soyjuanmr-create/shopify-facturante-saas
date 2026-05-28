/** @jsxImportSource preact */
import { useState, useEffect } from "preact/hooks";

// Backend de ESTA app. App publica: shopifac-production. (En la rama main/privada
// debe apuntar a shopify-facturante-saas-production-d49a.)
const APP_URL = "https://shopifac-production.up.railway.app";

export default function PrintExt() {
  var i18n = shopify.i18n;
  var data = shopify.data;
  var [invoice, setInvoice] = useState(true);
  var [packing, setPacking] = useState(false);
  var [token, setToken] = useState(null);

  // El session/ID token autentica la peticion al backend y expira ~1 min: se refresca.
  useEffect(function () {
    var alive = true;
    function refresh() { shopify.idToken().then(function (t) { if (alive) setToken(t); }).catch(function () {}); }
    refresh();
    var iv = setInterval(refresh, 45000);
    return function () { alive = false; clearInterval(iv); };
  }, []);

  function getSrc() {
    var types = [];
    if (invoice) types.push("invoice");
    if (packing) types.push("packing_slip");
    if (types.length > 0 && data.selected && data.selected.length > 0 && token) {
      return APP_URL + "/api/print?printType=" + types.join(",") + "&orderId=" + encodeURIComponent(data.selected[0].id) + "&token=" + encodeURIComponent(token);
    }
    return null;
  }

  return (
    <s-admin-print-action src={getSrc()}>
      <s-stack direction="block">
        <s-text type="strong">{i18n.translate("documents")}</s-text>
        <s-checkbox name="invoice" checked={invoice} label={i18n.translate("invoice")}
          onChange={(e) => setInvoice(e.target.checked)} />
        <s-checkbox name="packing" checked={packing} label={i18n.translate("packingSlip")}
          onChange={(e) => setPacking(e.target.checked)} />
      </s-stack>
    </s-admin-print-action>
  );
}
