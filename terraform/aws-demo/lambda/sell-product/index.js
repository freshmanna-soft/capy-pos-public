/**
 * Lambda: Sell Product
 *
 * Responsibility: Process a product sale (decrement stock, create transaction)
 * Route: POST /api/products/{id}/sell
 *
 * Failure Scenarios (when ENABLE_FAILURE=true):
 *   - Sells product even with 0 stock → throws ConditionalCheckFailedException
 */

const { initTelemetry, flushTelemetry } = require('./shared/telemetry');
const { GetCommand, UpdateCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./shared/dynamodb');
const { log, response } = require('./shared/logger');
const { v4: uuidv4 } = require('uuid');

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;
const TRANSACTIONS_TABLE = process.env.TRANSACTIONS_TABLE;
const failureMode = process.env.ENABLE_FAILURE === 'true';

exports.handler = async (event) => {
  const productId = event.pathParameters?.id;
  const body = event.body ? JSON.parse(event.body) : {};
  const quantity = body.quantity || 1;

  log('info', 'SellProduct invoked', { productId, quantity, failureMode });

  if (!productId) {
    return response(400, { error: 'Product ID is required' });
  }

  try {
    // Fetch current product
    const productResult = await docClient.send(
      new GetCommand({
        TableName: PRODUCTS_TABLE,
        Key: { id: productId },
      })
    );

    const product = productResult.Item;
    if (!product) {
      log('error', 'Product not found', { productId });
      return response(404, { error: 'Product not found', productId });
    }

    // FAILURE SCENARIO: Negative stock — throws when stock is already 0
    if (failureMode && product.stock <= 0) {
      const error = new Error(
        `FAILURE_SCENARIO: Stock already at ${product.stock} for product ${product.id}. ` +
          `ConditionalCheckFailed equivalent.`
      );
      error.code = 'ConditionalCheckFailedException';
      error.productId = product.id;
      error.currentStock = product.stock;
      log('error', 'FAILURE_SCENARIO: Negative stock condition', {
        scenario: 'negative-stock',
        productId: product.id,
        stock: product.stock,
      });
      throw error;
    }

    // Normal validation
    if (product.stock < quantity) {
      log('warn', 'Insufficient stock', {
        productId,
        available: product.stock,
        requested: quantity,
      });
      return response(400, {
        error: 'Insufficient stock',
        productId,
        available: product.stock,
        requested: quantity,
      });
    }

    // Decrement stock
    await docClient.send(
      new UpdateCommand({
        TableName: PRODUCTS_TABLE,
        Key: { id: productId },
        UpdateExpression: 'SET stock = stock - :qty',
        ExpressionAttributeValues: { ':qty': quantity },
      })
    );

    // Create transaction record
    const transaction = {
      id: uuidv4(),
      productId,
      productName: product.name,
      quantity,
      unitPrice: product.price,
      total: product.price * quantity,
      type: 'sale',
      timestamp: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: TRANSACTIONS_TABLE,
        Item: transaction,
      })
    );

    log('info', 'Sale completed successfully', {
      transactionId: transaction.id,
      productId,
      quantity,
      total: transaction.total,
    });

    return response(200, {
      message: 'Sale completed',
      transaction,
      remainingStock: product.stock - quantity,
    });
  } catch (error) {
    log('error', 'SellProduct failed', {
      error: error.message,
      code: error.code,
      productId,
      stack: error.stack,
    });
    return response(500, {
      error: 'Sale failed',
      message: error.message,
      code: error.code || 'UNKNOWN',
      traceId: process.env._X_AMZN_TRACE_ID || 'unavailable',
    });
  }
};
