/**
 * DynamoDB client instrumented with X-Ray
 * Shared across all Lambda functions
 */

const AWSXRay = require('aws-xray-sdk-core');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

const ddbClient = AWSXRay.captureAWSv3Client(new DynamoDBClient({}));
const docClient = DynamoDBDocumentClient.from(ddbClient);

module.exports = { docClient };
