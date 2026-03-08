/** @jsxImportSource preact */
import { useState } from 'preact/hooks';
import {
  useApplyAttributeChange,
  useAttributeValues,
  useTranslate,
} from '@shopify/ui-extensions/checkout/preact';

export default function CheckoutDNI() {
  var applyAttributeChange = useApplyAttributeChange();
  var [savedDoc] = useAttributeValues(['Documento']);
  var translate = useTranslate();
  var [value, setValue] = useState(savedDoc || '');
  var [error, setError] = useState('');

  function handleInput(e) {
    var nums = (e.target.value || '').replace(/\D/g, '');
    setValue(nums);
    setError('');
    applyAttributeChange({ key: 'Documento', type: 'updateAttribute', value: nums });
  }

  function handleBlur() {
    if (!value) { setError(''); return; }
    var len = value.length;
    if (len < 7 || (len > 8 && len < 11) || len > 11) {
      setError(translate('error_length'));
    } else {
      setError('');
    }
  }

  return (
    <s-stack direction="block">
      <s-text-field
        label={translate('label')}
        value={value}
        input-mode="numeric"
        error={error || undefined}
        onInput={handleInput}
        onBlur={handleBlur}
      />
    </s-stack>
  );
}
