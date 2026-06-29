/**
 * Lambda: Get Products
 *
 * Responsibility: Retrieve all products from the catalog
 * Route: GET /api/products
 *
 * Failure Scenarios (when ENABLE_FAILURE=true):
 *   - Simulated slow query (25s delay → Lambda timeout)
 *   - Random data corruption (null name/price on one product)
 */

const { initTelemetry, flushTelemetry } = require('./shared/telemetry');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./shared/dynamodb');
const { log, response } = require('./shared/logger');

initTelemetry();

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const failureMode = process.env.ENABLE_FAILURE === 'true';

exports.handler = async (event) => {
  log('info', 'GetProducts invoked', { table: PRODUCTS_TABLE, failureMode });

  try {
    // ... handler code ...
    // FAILURE SCENARIO 1: Simulated slow DynamoDB query → Lambda timeout
    if (failureMode) {
      log('warn', 'FAILURE_SCENARIO: Simulating slow DynamoDB query', {
        scenario: 'timeout',
        delay_ms: 25000,
      });
      await new Promise((resolve) => setTimeout(resolve, 25000));
    }

    const result = await docClient.send(
      new ScanCommand({
        TableName: PRODUCTS_TABLE,
      })
    );

    let products = result.Items || [];

    // FAILURE SCENARIO 2: Data corruption
    if (failureMode && products.length > 0) {
      const idx = Math.floor(Math.random() * products.length);
      log('warn', 'FAILURE_SCENARIO: Corrupting product data', {
        scenario: 'data-corruption',
        productIndex: idx,
        productId: products[idx].id,
      });
      products[idx].price = undefined;
      products[idx].name = null;
    }

    log('info', 'Products fetched successfully', { count: products.length });
    return response(200, { products, count: products.length });
  } catch (error) {
    log('error', 'Failed to fetch products', {
      error: error.message,
      code: error.code,
      stack: error.stack,
    });
    return response(500, {
      error: 'Failed to fetch products',
      message: error.message,
      traceId: process.env._X_AMZN_TRACE_ID || 'unavailable',
    });
  } finally {
    await flushTelemetry();
  }
};
