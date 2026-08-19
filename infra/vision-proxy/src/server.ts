import { createServer } from 'node:http';
import { identify, validate } from './identify.ts';

/**
 * Local development server.
 *
 * Lets you point a dev build at a real recognizer without deploying anything:
 *
 *   ANTHROPIC_API_KEY=... npm start        # here
 *   # then set features.aiVision = true and apiUrl = 'http://localhost:8787'
 *   #      and visionApiPath = '/vision/identify' in src/environments/environment.ts
 *
 * CORS is wide open because this is a dev tool. The deployed path is the Lambda
 * handler behind the existing API Gateway authorizer; do not run this in front of
 * anything real.
 */
const PORT = Number(process.env['PORT'] ?? 8787);

createServer((req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }
  if (req.method !== 'POST' || !req.url?.endsWith('/vision/identify')) {
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'POST /vision/identify' }));
    return;
  }

  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    void (async () => {
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };

      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        send(400, { error: 'Body must be JSON.' });
        return;
      }

      const request = validate(parsed);
      if ('error' in request) {
        send(400, { error: request.error });
        return;
      }

      try {
        send(200, await identify(request));
      } catch (error) {
        console.error('[vision] recognition failed', error);
        send(502, { error: 'Recognition is unavailable.' });
      }
    })();
  });
}).listen(PORT, () => {
  console.log(`[vision] dev proxy listening on http://localhost:${PORT}/vision/identify`);
});
