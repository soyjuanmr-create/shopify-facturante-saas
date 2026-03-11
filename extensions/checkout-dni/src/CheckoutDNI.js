/** @jsxImportSource preact */
import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useState } from 'preact/hooks';

function CheckoutDNI() {
  var [docType, setDocType] = useState('DNI');
  var [docValue, setDocValue] = useState('');
  var [error, setError] = useState('');
  var [needsInvoice, setNeedsInvoice] = useState(false);

  var validate = function (type, value) {
    if (!value) return '';
    if (type === 'DNI') return /^\d{7,8}$/.test(value) ? '' : shopify.i18n.translate('errorDni');
    return /^\d{11}$/.test(value) ? '' : shopify.i18n.translate('errorCuit');
  };

  var saveAttr = async function (key, value) {
    await shopify.applyAttributeChange({ type: 'updateAttribute', key: key, value: value });
  };

  var handleDoc = async function (value) {
    var digits = value.replace(/\D/g, '');
    setDocValue(digits);
    var err = validate(docType, digits);
    setError(err);
    if (!err && digits) {
      await saveAttr('documento_identidad', digits);
      await saveAttr('tipo_documento', docType);
    }
  };

  var handleTypeChange = async function (newType) {
    setDocType(newType);
    if (docValue) {
      var err = validate(newType, docValue);
      setError(err);
      if (!err) await saveAttr('tipo_documento', newType);
    }
  };

  var handleToggle = async function (checked) {
    setNeedsInvoice(checked);
    if (!checked) {
      await saveAttr('documento_identidad', '');
      await saveAttr('tipo_documento', '');
      setDocValue('');
      setError('');
    }
  };

  return (
    <s-section>
      <s-checkbox checked={needsInvoice} onChange={(e) => handleToggle(e.target.checked)}>
        {shopify.i18n.translate('needsInvoice')}
      </s-checkbox>
      {needsInvoice && (
        <s-stack direction="block" gap="base">
          <s-select
            label={shopify.i18n.translate('docType')}
            value={docType}
            onChange={(e) => handleTypeChange(e.target.value)}
          >
            <option value="DNI">DNI</option>
            <option value="CUIL">CUIL</option>
            <option value="CUIT">CUIT</option>
          </s-select>
          <s-text-field
            label={shopify.i18n.translate('docNumber') + ' (' + docType + ')'}
            value={docValue}
            onInput={(e) => handleDoc(e.target.value)}
            error={error || undefined}
            type="text"
            autocomplete="off"
          />
        </s-stack>
      )}
    </s-section>
  );
}

export default function extension() {
  render(<CheckoutDNI />, document.body);
}
