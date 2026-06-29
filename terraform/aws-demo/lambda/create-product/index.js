/**
 * Lambda: Create Product
 *
 * Responsibility: Create a new product in the catalog
 * Route: POST /api/products
 *
 * Accepts: { id, name, price, category, stock, description? }
 * Returns: { product: {...} }
 */

const { initTelemetry, flushTelemetry } = require('./shared/telemetry');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./shared/dynamodb');
const { log, response } = require('./shared/logger');

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;

exports.handler = async (event) => {
  log('info', 'CreateProduct invoked', { table: PRODUCTS_TABLE });

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    // Validate required fields
    if (!body.id || !body.name || body.price === undefined || !body.category) {
      return response(400, {
        error: 'Missing required fields: id, name, price, category',
      });
    }

    const product = {
      id: body.id,
      name: body.name,
      price: Number(body.price),
      category: body.category,
      stock: body.stock !== undefined ? Number(body.stock) : 0,
      description: body.description || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(
      new PutCommand({
        TableName: PRODUCTS_TABLE,
        Item: product,
        // Prevent overwriting existing products (use PUT /api/products/{id} for updates)
        ConditionExpression: 'attribute_not_exists(id)',
      })
    );

    log('info', 'Product created successfully', { productId: product.id });

    return response(201, { product });
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      log('warn', 'Product already exists', { error: error.message });
      return response(409, { error: 'Product with this ID already exists' });
    }

    log('error', 'Failed to create product', { error: error.message });
    return response(500, { error: 'Internal server error' });
  }
};
