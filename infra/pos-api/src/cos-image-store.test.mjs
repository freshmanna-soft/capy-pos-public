import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CosImageStore } from './cos-image-store.ts';

const CONFIG = {
  endpoint: 'https://s3.us-south.cloud-object-storage.appdomain.cloud',
  apiKey: 'test-api-key',
  bucket: 'product-images',
  publicUrlBase: 'https://s3.us-south.cloud-object-storage.appdomain.cloud/product-images',
};

function fakeFetch() {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    calls.push({
      url: String(input),
      method: init.method ?? 'GET',
      headers: init.headers,
      body: init.body,
    });
    if (String(input).startsWith('https://iam.cloud.ibm.com/')) {
      return new Response(JSON.stringify({ access_token: 'iam-token', expires_in: 3600 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(null, { status: 200 });
  };
  return { calls, fetchImpl };
}

describe('CosImageStore', () => {
  it('exchanges IAM once, uploads a namespaced object, and reuses the token', async () => {
    const { calls, fetchImpl } = fakeFetch();
    let now = 1_000_000;
    const store = new CosImageStore(CONFIG, fetchImpl, () => now);
    const bytes = new Uint8Array([1, 2, 3]);

    const first = await store.upload('prod-001', 'image/jpeg', bytes);
    const second = await store.upload('prod-002', 'image/png', bytes);

    assert.equal(first, `${CONFIG.publicUrlBase}/products/prod-001`);
    assert.equal(second, `${CONFIG.publicUrlBase}/products/prod-002`);
    assert.equal(
      calls.filter((call) => call.url.startsWith('https://iam.cloud.ibm.com/')).length,
      1
    );

    const put = calls.filter((call) => call.method === 'PUT');
    assert.equal(put.length, 2);
    assert.match(put[0].url, /product-images\/products\/prod-001$/);
    assert.equal(put[0].headers.Authorization, 'Bearer iam-token');
    assert.equal(put[0].headers['Content-Type'], 'image/jpeg');
    assert.equal(put[0].headers['Content-Length'], '3');
    assert.equal(put[0].body, bytes);

    now += 4_000_000;
    await store.upload('prod-003', 'image/webp', bytes);
    assert.equal(
      calls.filter((call) => call.url.startsWith('https://iam.cloud.ibm.com/')).length,
      2
    );
  });

  it('fails when IAM cannot issue a token', async () => {
    const store = new CosImageStore(CONFIG, async (input) => {
      if (String(input).startsWith('https://iam.cloud.ibm.com/'))
        return new Response(null, { status: 503 });
      return new Response(null, { status: 200 });
    });

    await assert.rejects(
      store.upload('prod-001', 'image/jpeg', new Uint8Array([1])),
      /IAM token exchange failed with 503/
    );
  });

  it('fails when COS rejects the upload', async () => {
    const { fetchImpl } = fakeFetch();
    const store = new CosImageStore(CONFIG, async (input, init) => {
      if (String(input).startsWith('https://iam.cloud.ibm.com/')) return fetchImpl(input, init);
      return new Response(null, { status: 500 });
    });

    await assert.rejects(
      store.upload('prod-001', 'image/jpeg', new Uint8Array([1])),
      /COS upload failed with 500/
    );
  });
});
