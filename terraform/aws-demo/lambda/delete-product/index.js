/**
 * Lambda: Delete Product
 *
 * Responsibility: Remove a product from the catalog
 * Route: DELETE /api/products/{id}
 *
 * Guarded on attribute_exists(id) so deleting a missing product returns 404
 * rather than silently succeeding.
 */

const { initTelemetry, flushTelemetry } = require('./shared/telemetry');
const { DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./shared/dynamodb');
const { log, response } = require('./shared/logger');

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;

exports.handler = async (event) => {
  const productId = event.pathParameters?.id;

  log('info', 'DeleteProduct invoked', { productId, table: PRODUCTS_TABLE });

  if (!productId) {
    return response(400, { error: 'Product ID is required' });
  }

  try {
    const result = await docClient.send(
      new DeleteCommand({
        TableName: PRODUCTS_TABLE,
        Key: { id: productId },
        ConditionExpression: 'attribute_exists(id)',
        ReturnValues: 'ALL_OLD',
      })
    );

    log('info', 'Product deleted successfully', { productId });
    return response(200, { message: 'Product deleted', product: result.Attributes });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      log('warn', 'Product not found for deletion', { productId });
      return response(404, { error: 'Product not found', productId });
    }
    log('error', 'Failed to delete product', { error: error.message, productId });
    return response(500, { error: 'Internal server error' });
  }
};
