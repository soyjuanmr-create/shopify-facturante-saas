/**
 * cronSync.js
 * Cron job que sincroniza automáticamente las órdenes en estado 'processing'.
 * Se ejecuta cada 30 minutos y consulta Facturante por cada comprobante pendiente.
 * Evita que el merchant tenga que hacer clic manual en "Verificar estado".
 */

const prisma = require('../models/prisma');
const FacturanteService = require('./facturante');
const { setInvoiceMetafields } = require('../utils/shopifyMetafields');
const logger = require('../utils/logger');

const INTERVAL_MS = 30 * 60 * 1000;   // 30 minutos
const MIN_AGE_MS = 10 * 60 * 1000;   // sólo procesar si tiene más de 10 min
const MAX_BATCH = 20;                // máximo por ejecución para no sobrecargar

async function syncProcessingInvoices() {
    logger.info('[cronSync] Iniciando ciclo de sincronización...');

    const cutoff = new Date(Date.now() - MIN_AGE_MS);

    let invoices;
    try {
        invoices = await prisma.invoice.findMany({
            where: {
                status: 'processing',
                facturanteInvoiceId: { not: null },
                createdAt: { lt: cutoff },
            },
            include: { shop: true },
            take: MAX_BATCH,
            orderBy: { createdAt: 'asc' },
        });
    } catch (err) {
        logger.error('[cronSync] Error al consultar BD: ' + err.message);
        return;
    }

    if (invoices.length === 0) {
        logger.info('[cronSync] No hay comprobantes pendientes.');
        return;
    }

    logger.info('[cronSync] Procesando ' + invoices.length + ' comprobante(s) pendiente(s)...');

    for (const invoice of invoices) {
        const shop = invoice.shop;
        if (!shop || !shop.empresa || !shop.hash) {
            logger.warn('[cronSync] Shop sin credenciales, omitiendo orderId=' + invoice.shopifyOrderId);
            continue;
        }

        try {
            // PASO 1: Verificar que siga en estado 'processing' ANTES de consultar
            // (podría haber sido actualizado por webhook en el interim)
            const currentInvoice = await prisma.invoice.findUnique({
                where: { id: invoice.id }
            });

            if (currentInvoice.status !== 'processing') {
                logger.info('[cronSync] invoice ' + invoice.shopifyOrderId + ' ya no está en processing (status=' + currentInvoice.status + '), saltando');
                continue;
            }

            // PASO 2: Consultar Facturante
            const facturante = new FacturanteService({
                empresa: shop.empresa,
                usuario: shop.usuario,
                hash: shop.hash,
                puntoVenta: shop.puntoVenta,
            });

            const result = await facturante.consultarComprobante(invoice.facturanteInvoiceId);
            logger.info('[cronSync] orderId=' + invoice.shopifyOrderId + ' estado=' + result.estado + ' cae=' + result.cae);

            const estadoOk = result.estado === 'autorizado' || result.estado === 'ok';

            if (estadoOk && result.cae) {
                const caeStr = result.cae.toString();
                const numStr = result.numero ? result.numero.toString() : (invoice.facturanteInvoiceNumber || null);

                // PASO 3: Actualizar BD de forma atómica (si sigue en processing)
                const updated = await prisma.invoice.updateMany({
                    where: {
                        id: invoice.id,
                        status: 'processing'  // ← Condición: solo si SIGUE en processing
                    },
                    data: {
                        status: 'completed',
                        cae: caeStr,
                        facturanteInvoiceNumber: numStr,
                        processedAt: new Date()
                    },
                });

                if (updated.count === 0) {
                    logger.info('[cronSync] orderId=' + invoice.shopifyOrderId + ' ya fue actualizado por otro proceso (webhook?), saltando metafields');
                    continue;
                }

                // PASO 4: Escribir metafields solo si LOGRAMOS actualizar
                const sessionRec = await prisma.session.findFirst({
                    where: { shop: shop.shopDomain, isOnline: false },
                    orderBy: { expires: 'desc' },
                });
                const accessToken = (sessionRec && sessionRec.accessToken) ? sessionRec.accessToken : shop.accessToken;

                if (accessToken) {
                    try {
                        await setInvoiceMetafields(
                            { shop: shop.shopDomain, accessToken },
                            invoice.shopifyOrderId,
                            { status: 'completed', cae: caeStr, invoiceNumber: numStr }
                        );
                    } catch (metaErr) {
                        logger.warn('[cronSync] Falla al escribir metafields para ' + invoice.shopifyOrderId + ': ' + metaErr.message);
                        // No romper el flujo
                    }
                }

                logger.info('[cronSync] ✓ orderId=' + invoice.shopifyOrderId + ' completado. CAE=' + caeStr);

            } else if (result.estado && result.estado !== 'procesando' && result.estado !== 'processing') {
                // Estado inesperado (no es éxito ni "aún procesando") → marcar como fallido
                await prisma.invoice.updateMany({
                    where: {
                        id: invoice.id,
                        status: 'processing'
                    },
                    data: {
                        status: 'failed',
                        errorMessage: result.mensaje || result.estado,
                    },
                });
                logger.warn('[cronSync] ✗ orderId=' + invoice.shopifyOrderId + ' marcado failed. estado=' + result.estado);
            }
            // Si estado es 'procesando'/'processing' o vacío: no hacer nada, lo revisará en el próximo ciclo

        } catch (err) {
            logger.error('[cronSync] Error al procesar orderId=' + invoice.shopifyOrderId + ': ' + err.message);
            // No marcar como failed: puede ser un error temporal de red
        }

        // Pequeña pausa entre requests para no saturar la API de Facturante
        await new Promise(r => setTimeout(r, 500));
    }

    logger.info('[cronSync] Ciclo completado.');
}

function startCron() {
    logger.info('[cronSync] Cron de sincronización iniciado. Intervalo: ' + (INTERVAL_MS / 60000) + ' minutos.');
    // Primera ejecución con 2 minutos de delay para dar tiempo al servidor de arrancar
    setTimeout(() => {
        syncProcessingInvoices();
        setInterval(syncProcessingInvoices, INTERVAL_MS);
    }, 2 * 60 * 1000);
}

module.exports = { startCron, syncProcessingInvoices };
