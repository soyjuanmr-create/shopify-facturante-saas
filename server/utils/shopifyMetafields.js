const axios = require('axios');
const logger = require('./logger');

const MUTATION = `
  mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key value }
      userErrors { field message code }
    }
  }
`;

/**
 * Write invoice metafields to a Shopify order.
 * @param {{ shop: string, accessToken: string }} session
 * @param {string} orderId  - Numeric order ID (e.g. "123456")
 * @param {{ status: string, cae?: string, invoiceNumber?: string, error?: string }} data
 */
async function setInvoiceMetafields(session, orderId, data) {
  try {
    const ownerId = 'gid://shopify/Order/' + orderId;
    const metafields = [
      { ownerId, namespace: 'shopifac', key: 'invoice_status', type: 'single_line_text_field', value: data.status },
    ];
    if (data.cae) {
      metafields.push({ ownerId, namespace: 'shopifac', key: 'invoice_cae', type: 'single_line_text_field', value: data.cae });
    }
    if (data.invoiceNumber) {
      metafields.push({ ownerId, namespace: 'shopifac', key: 'invoice_number', type: 'single_line_text_field', value: data.invoiceNumber });
    }
    if (data.error) {
      metafields.push({ ownerId, namespace: 'shopifac', key: 'invoice_error', type: 'single_line_text_field', value: data.error.substring(0, 255) });
    }

    const url = 'https://' + session.shop + '/admin/api/2025-04/graphql.json';
    const resp = await axios.post(url, { query: MUTATION, variables: { metafields } }, {
      headers: { 'X-Shopify-Access-Token': session.accessToken, 'Content-Type': 'application/json' },
    });
    const userErrors = resp.data?.data?.metafieldsSet?.userErrors || [];
    if (userErrors.length > 0) {
      logger.warn('Metafields userErrors for order ' + orderId + ': ' + JSON.stringify(userErrors));
    }
  } catch (err) {
    // Non-critical — log and continue, don't break the main flow
    logger.error('setInvoiceMetafields failed for order ' + orderId + ': ' + err.message);
  }
}

module.exports = { setInvoiceMetafields };
