import { useState } from 'react';
import {
  reactExtension,
  BlockStack,
  TextField,
  useApplyAttributeChange,
  useAttributeValues,
  useTranslate,
} from '@shopify/ui-extensions-react/checkout';

export default reactExtension(
  'purchase.checkout.contact.render-after',
  () => <CheckoutDNI />
);

function CheckoutDNI() {
  var translate = useTranslate();
  var applyAttribute = useApplyAttributeChange();
  var [savedValue] = useAttributeValues(['Documento']);
  var [value, setValue] = useState(savedValue || '');
  var [error, setError] = useState('');

  function handleChange(newVal) {
    var nums = newVal.replace(/\D/g, '');
    setValue(nums);
    setError('');
    applyAttribute({ key: 'Documento', value: nums });
  }

  function handleBlur() {
    if (!value) { setError(''); return; }
    if (value.length < 7 || (value.length > 8 && value.length < 11) || value.length > 11) {
      setError(translate('error_length'));
    }
  }

  return (
    <BlockStack>
      <TextField
        label={translate('label')}
        value={value}
        onChange={handleChange}
        onBlur={handleBlur}
        error={error}
        inputMode="numeric"
      />
    </BlockStack>
  );
}
