/**
 * Lambda: Health Check
 *
 * Responsibility: Report service health and configuration status
 * Route: GET /api/health
 */

const { log, response } = require('./shared/logger');

exports.handler = async (event) => {
  log('info', 'Health check invoked');

  return response(200, {
    status: 'healthy',
    service: 'capy-pos-demo',
    version: '1.0.0',
    architecture: 'single-responsibility-lambdas',
    failureMode: process.env.ENABLE_FAILURE === 'true',
    region: process.env.AWS_REGION || 'unknown',
    timestamp: new Date().toISOString(),
    endpoints: {
      getProducts: 'GET /api/products',
      sellProduct: 'POST /api/products/{id}/sell',
      getTransactions: 'GET /api/transactions',
      health: 'GET /api/health',
    },
  });
};
