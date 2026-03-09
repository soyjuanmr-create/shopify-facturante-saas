import {
    extension,
    TextField,
    BlockStack,
} from '@shopify/ui-extensions/checkout';

export default extension(
    'purchase.checkout.block.render',
    (root, api) => {
        const { applyAttributeChange, attributes, instructions, i18n } = api;

        const savedAttr = attributes.current.find(
            (a) => a.key === 'documento_identidad',
        );
        const initialValue = savedAttr ? savedAttr.value : '';

        const textField = root.createComponent(TextField, {
            label: i18n.translate('label'),
            value: initialValue,
            inputMode: 'numeric',
            autocomplete: 'off',
            onChange(newValue) {
                const digits = (newValue || '').replace(/\D/g, '');
                textField.updateProps({ value: digits, error: undefined });
                if (!instructions.current.attributes.canUpdateAttributes) return;
                applyAttributeChange({
                    key: 'documento_identidad',
                    type: 'updateAttribute',
                    value: digits,
                });
            },
            onBlur() {
                const val = textField.props.value || '';
                if (!val) {
                    textField.updateProps({ error: undefined });
                    return;
                }
                const len = val.length;
                if (len < 7 || (len > 8 && len < 11) || len > 11) {
                    textField.updateProps({ error: i18n.translate('error_length') });
                } else {
                    textField.updateProps({ error: undefined });
                }
            },
        });

        const stack = root.createComponent(BlockStack);
        stack.appendChild(textField);
        root.appendChild(stack);
    },
);
