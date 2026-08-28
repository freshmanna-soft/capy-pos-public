import { createServer } from 'node:http';
import { relay } from './relay.ts';
import { validate } from './validate.ts';

/**
 * Local development server.
 *
 * Lets you point a dev build at the real clerk without deploying anything:
 *
 *   ANTHROPIC_API_KEY=... npm run clerk-agent:relay    # repo root, port 8789
 *   # then set features.clerkAgent = true and
 *   #      clerkAgentApiUrl = 'http://localhost:8789/clerk/agent'
 *   #      in the environment file you are serving
 *
 * CORS is wide open and no token is checked, because this is a dev tool. That
 * matters more here than it does for the vision proxy: this endpoint holds tools
 * that change a cart, so anything that can reach this port can spend the key *and*
 * drive the till. Do not run it in front of anything real — the deployed path is
 * `lambda.ts` behind the existing API Gateway authorizer.
 */
const PORT = Number(process.env['PORT'] ?? 8789);

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
  if (req.method !== 'POST' || !req.url?.endsWith('/clerk/agent')) {
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'POST /clerk/agent' }));
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
        send(200, await relay(request));
      } catch (error) {
        console.error('[clerk-agent] hop failed', error);
        send(502, { error: 'The clerk is unavailable.' });
      }
    })();
  });
}).listen(PORT, () => {
  console.log(`[clerk-agent] dev relay listening on http://localhost:${PORT}/clerk/agent`);
});
