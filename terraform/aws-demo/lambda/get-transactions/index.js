/**
 * Lambda: Get Transactions
 *
 * Responsibility: Retrieve all sales transactions
 * Route: GET /api/transactions
 */

const { ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('./shared/dynamodb');
const { log, response } = require('./shared/logger');

const TRANSACTIONS_TABLE = process.env.TRANSACTIONS_TABLE;

exports.handler = async (event) => {
  log('info', 'GetTransactions invoked', { table: TRANSACTIONS_TABLE });

  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: TRANSACTIONS_TABLE,
      })
    );

    const transactions = result.Items || [];

    // Sort by timestamp descending (most recent first)
    transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    log('info', 'Transactions fetched successfully', { count: transactions.length });
    return response(200, { transactions, count: transactions.length });
  } catch (error) {
    log('error', 'Failed to fetch transactions', {
      error: error.message,
      code: error.code,
      stack: error.stack,
    });
    return response(500, {
      error: 'Failed to fetch transactions',
      message: error.message,
      traceId: process.env._X_AMZN_TRACE_ID || 'unavailable',
    });
  }
};
