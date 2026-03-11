/** @jsxImportSource preact */
import { useState } from "preact/hooks";

const APP_URL = "https://shopify-facturante-saas-production-d49a.up.railway.app";

export default function PrintExt() {
  var i18n = shopify.i18n;
  var data = shopify.data;
  var [invoice, setInvoice] = useState(true);
  var [packing, setPacking] = useState(false);

  function getSrc() {
    var types = [];
    if (invoice) types.push("invoice");
    if (packing) types.push("packing_slip");
    if (types.length > 0 && data.selected && data.selected.length > 0) {
      return APP_URL + "/api/print?printType=" + types.join(",") + "&orderId=" + data.selected[0].id;
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
