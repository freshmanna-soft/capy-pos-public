/**
 * Lambda: Update Product
 *
 * Responsibility: Update an existing product in the catalog
 * Routes:
 *   PUT   /api/products/{id}  → full replace (idempotent)
 *   PATCH /api/products/{id}  → partial update (only provided fields)
 *
 * Both routes guard on attribute_exists(id) so they only ever update an
 * existing product (use POST /api/products to create).
 */

const { initTelemetry, flushTelemetry } = require('./shared/telemetry');
const { GetCommand, PutCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./shared/dynamodb');
const { log, response } = require('./shared/logger');

const PRODUCTS_TABLE = process.env.PRODUCTS_TABLE;

// Fields a client is allowed to write. id/createdAt are managed server-side.
// isActive is included so the UI can soft-delete (isActive:false) instead of
// hard-deleting products that transaction history still references.
const MUTABLE_FIELDS = ['name', 'price', 'category', 'stock', 'description', 'isActive'];

exports.handler = async (event) => {
  const productId = event.pathParameters?.id;
  const method = event.requestContext?.http?.method || 'PATCH';

  log('info', 'UpdateProduct invoked', { productId, method, table: PRODUCTS_TABLE });

  if (!productId) {
    return response(400, { error: 'Product ID is required' });
  }

  let body;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }

  try {
    if (method === 'PUT') {
      return await replaceProduct(productId, body);
    }
    return await patchProduct(productId, body);
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      log('warn', 'Product not found for update', { productId });
      return response(404, { error: 'Product not found', productId });
    }
    log('error', 'Failed to update product', { error: error.message, productId });
    return response(500, { error: 'Internal server error' });
  }
};

/**
 * PUT — full replace. Requires the full set of required fields, preserves the
 * original createdAt, and fails if the product does not already exist.
 */
async function replaceProduct(productId, body) {
  if (!body.name || body.price === undefined || !body.category) {
    return response(400, { error: 'Missing required fields: name, price, category' });
  }

  // Preserve original createdAt (also confirms existence before the conditional Put).
  const existing = await docClient.send(
    new GetCommand({ TableName: PRODUCTS_TABLE, Key: { id: productId } })
  );
  if (!existing.Item) {
    return response(404, { error: 'Product not found', productId });
  }

  const product = {
    id: productId,
    name: body.name,
    price: Number(body.price),
    category: body.category,
    stock: body.stock !== undefined ? Number(body.stock) : 0,
    description: body.description || '',
    createdAt: existing.Item.createdAt,
    updatedAt: new Date().toISOString(),
  };

  await docClient.send(
    new PutCommand({
      TableName: PRODUCTS_TABLE,
      Item: product,
      ConditionExpression: 'attribute_exists(id)',
    })
  );

  log('info', 'Product replaced successfully', { productId });
  return response(200, { product });
}

/**
 * PATCH — partial update. Builds an UpdateExpression from whichever mutable
 * fields are present in the body.
 */
async function patchProduct(productId, body) {
  const names = {};
  const values = { ':updatedAt': new Date().toISOString() };
  const sets = ['#updatedAt = :updatedAt'];
  names['#updatedAt'] = 'updatedAt';

  for (const field of MUTABLE_FIELDS) {
    if (body[field] === undefined) continue;
    const value = field === 'price' || field === 'stock' ? Number(body[field]) : body[field];
    names[`#${field}`] = field;
    values[`:${field}`] = value;
    sets.push(`#${field} = :${field}`);
  }

  if (sets.length === 1) {
    return response(400, {
      error: `No updatable fields provided. Allowed: ${MUTABLE_FIELDS.join(', ')}`,
    });
  }

  const result = await docClient.send(
    new UpdateCommand({
      TableName: PRODUCTS_TABLE,
      Key: { id: productId },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW',
    })
  );

  log('info', 'Product patched successfully', { productId });
  return response(200, { product: result.Attributes });
}
