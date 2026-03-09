const axios = require('axios');
const logger = require('./logger');

const GRAPHQL_VERSION = '2025-04';

async function shopifyGraphql(shopDomain, accessToken, query, variables) {
  const url = `https://${shopDomain}/admin/api/${GRAPHQL_VERSION}/graphql.json`;
  const resp = await axios.post(
    url,
    variables ? { query, variables } : { query },
    { headers: { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' } },
  );
  if (resp.data.errors) {
    throw new Error(resp.data.errors.map((e) => e.message).join(', '));
  }
  return resp.data;
}

async function getPublishedCheckoutProfileId(shopDomain, accessToken) {
  const data = await shopifyGraphql(shopDomain, accessToken, `{
    checkoutProfiles(first: 1, query: "is_published:true") {
      edges { node { id } }
    }
  }`);
  const edges = data.data?.checkoutProfiles?.edges;
  if (!edges || edges.length === 0) throw new Error('No se encontró checkout profile publicado');
  return edges[0].node.id;
}

/**
 * Activa la extensión checkout-dni en el perfil de checkout publicado del merchant
 * y habilita el setting enable_dni = true.
 * Es no-bloqueante: los errores se loguean pero no interrumpen el flujo OAuth.
 */
async function activateCheckoutExtension(shopDomain, accessToken) {
  try {
    const profileId = await getPublishedCheckoutProfileId(shopDomain, accessToken);

    const mutation = `
      mutation extensionActivationCreate($input: ExtensionActivationCreateInput!) {
        extensionActivationCreate(input: $input) {
          extensionActivation { id }
          userErrors { field message }
        }
      }
    `;

    const result = await shopifyGraphql(shopDomain, accessToken, mutation, {
      input: {
        checkoutProfileId: profileId,
        handle: 'shopifac-checkout-dni',
        settings: { enable_dni: true },
      },
    });

    const errors = result.data?.extensionActivationCreate?.userErrors;
    if (errors && errors.length > 0) {
      logger.warn(`checkoutExtension: userErrors para ${shopDomain}: ${JSON.stringify(errors)}`);
    } else {
      logger.info(`checkoutExtension: extensión DNI activada para ${shopDomain}`);
    }
  } catch (err) {
    // No interrumpir el flujo OAuth — solo loguear
    logger.warn(`checkoutExtension: error activando extensión para ${shopDomain}: ${err.message}`);
  }
}

module.exports = { activateCheckoutExtension };
