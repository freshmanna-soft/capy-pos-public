# Capy vision proxy

The server side of the AI clerk at `/clerk`. It takes a camera frame and the
till's catalog, asks Claude which product is being held up, and returns
candidates with calibrated confidences.

It exists for one reason: **a browser bundle cannot hold a model API key.** Any
key shipped to the client is public the moment the app loads. So the key lives
here, and `ClaudeVisionAdapter` in the Angular app posts frames to this endpoint.

```
browser  ──POST {apiUrl}/vision/identify──▶  this proxy  ──▶  Claude (Opus 5)
  frame + catalog                              + key           candidates
```

## Contract

`POST /vision/identify`

```jsonc
// request
{
  "image": "<bare base64, no data: prefix>",
  "mediaType": "image/jpeg",
  "catalog": [{ "id": "p1", "name": "Avocado", "sku": "AVO-1", "category": "Produce", "emoji": "🥑" }]
}

// response
{
  "candidates": [{ "productId": "p1", "label": "Avocado", "confidence": 0.93 }],
  "utterance": "One avocado, added.",
  "empty": false
}
```

Any non-200 is treated by the client as "she didn't catch it" — the capybara says
so and the cashier holds the item up again. The proxy therefore never needs to
return a useful error body, and deliberately doesn't: no model errors, no stack
traces, no key material.

## Running it

**Locally**, against a real model, without deploying anything. Two terminals, from
the repo root:

```sh
export ANTHROPIC_API_KEY=sk-ant-...
npm run vision:proxy      # this proxy, on :8788
npm run start:vision      # the app, with real recognition switched on
```

`start:vision` is `ng serve --configuration vision`, which swaps in
`src/environments/environment.vision.ts` — a copy of the dev environment with
`features.aiVision: true` and `visionApiUrl` pointed at the proxy. It is a separate
build target rather than a flag flipped in `environment.ts` because live vision
costs money per frame, asks the operator for camera consent before it will start,
and would leave the e2e suite talking to a proxy that isn't running.

Port **8788** rather than `PORT`'s own 8787 default, only because 8787 was taken on
the machine this was last run on. The two scripts and `environment.vision.ts` agree
on it; change all three together or none.

To exercise the proxy without opening the app at all:

```sh
cd infra/vision-proxy && PORT=8788 node smoke.mjs
```

It draws a crude banana — no dependencies, just a hand-rolled PNG encoder — posts
it twice against a five-product catalog, and prints both replies. Twice
deliberately: the second call is the only way to see the prompt cache being read.
A healthy run says

```
call 1: HTTP 200 in 3125ms
{"candidates":[{"productId":"p-ban","label":"Banana","confidence":0.88}], …}
[vision] usage {"input":629,"cacheRead":0,"cacheWrite":758,"output":49}
[vision] usage {"input":629,"cacheRead":758,"cacheWrite":0,"output":49}
```

— a cache **write** on the first call and a **read** of the same size on the second.

`npm start` runs this TypeScript directly under Node's type stripping, which
constrains how the source may import. Relative specifiers name the real file
(`./identify.ts`, not `./identify.js`), and type-only imports must say
`import type` — Node cannot tell a type from a value, so a type left in a value
import survives the strip and fails at load. `tsc` accepts both and rewrites the
extensions on the way into `dist/`, and `verbatimModuleSyntax` turns a mistake here
into a build error rather than a crash on startup.

**Deployed**, as a Lambda behind the existing API Gateway:

```sh
npm run build                                # → dist/
# handler: dist/lambda.handler
# runtime: nodejs22.x   memory: 512MB   timeout: 15s
# env:     ANTHROPIC_API_KEY  (from your secrets manager, not a plaintext var)
```

Put it behind **the same authorizer as the rest of the Capy-POS API**. The client
already sends its bearer token on every call; an unauthenticated recognition
endpoint is an open, metered path to a paid model.

## What it costs, and the three dials that change it

Rough per-look arithmetic at Claude Opus 5 list prices ($5 / $25 per million
tokens in / out), a 768px frame, and a 20-product catalog:

| Component | Tokens | Cost |
|---|---:|---:|
| Frame (768 × 576) | ~590 in | $0.0030 |
| Question text | ~12 in | — |
| System prompt + catalog, **cache read** | ~740 @ 0.1× | $0.0004 |
| Response (thinking at low effort + JSON) | ~220 out | $0.0055 |
| **Per look** | | **≈ $0.009** |

The first call for a given catalog also pays a cache **write** (~$0.005); every
call after it reads instead, until the catalog changes.

At one to three looks per item, that is **roughly 1–3¢ per item scanned**. For
comparison, sending every frame of a 30fps camera would be about **$16 a minute**
— which is why `FrameGate` is a feature and not an optimization.

Three dials, in order of effect:

1. **Capture resolution** — `CAPTURE_MAX_EDGE` in
   `src/app/core/infrastructure/media/camera.service.ts`. Image tokens scale with
   *area*, so 768 → 512 roughly halves the input cost. Raise it only if
   recognition is genuinely failing on small print.
2. **Frame gate thresholds** — `DEFAULT_FRAME_GATE_CONFIG` in
   `frame-gate.ts`. `minIntervalMs` and `settleMs` set how often you can pay at
   all.
3. **`EFFORT`** in `identify.ts`, already at `low`. Output tokens are the largest
   single line above, and thinking is billed as output.

**Verify rather than trust the table.** Every call logs its token split:

```
[vision] usage {"input":602,"cacheRead":740,"cacheWrite":0,"output":214}
```

If `cacheRead` stays at `0` across consecutive calls with the same catalog, the
cache prefix is broken and you are paying full price for the catalog on every
frame. The usual cause is something volatile getting in front of the breakpoint —
the prompt is a prefix match, so the system blocks must be byte-identical and the
frame must stay in the user turn.

## Why the request is shaped the way it is

- **The catalog is sent with every frame.** It is what stops the model
  free-associating ("a green fruit") and makes it return an id the cart can use.
  `identify.ts` drops any candidate whose id isn't in the catalog it was given.
- **Stable content first, frame last.** Instructions and catalog sit in `system`
  with a cache breakpoint; the image goes in the user turn. Reversed, nothing
  caches.
- **Structured outputs, not prose parsing.** `RECOGNITION_SCHEMA` constrains the
  response, so there is no format to retry on. The schema can't enforce
  semantics, so ids are checked against the catalog and confidences are clamped
  after parsing — the next stop for this data is a shopping cart.
- **`stop_reason` is checked before `content`.** A declined request returns HTTP
  200 with an empty content array, so indexing `content[0]` would throw on
  precisely the frames least worth crashing over.
- **Thinking stays on at low effort** rather than being disabled: on this model
  disabling thinking can leak `<thinking>` tags into the response, and low effort
  already buys the latency and token saving.

## Privacy

With `features.aiVision` on, still frames leave the till. The clerk asks the
operator to agree once, on first entry, and names what is sent.

- Frames are held only for the duration of the request. Nothing is written to
  disk here.
- No video is transmitted — one JPEG per settled item.
- The endpoint logs token counts, never image data.

A camera pointed at a shop counter can capture customers. Check what signage your
jurisdiction requires before switching this on at a real till, and keep the camera
aimed at the goods.

## Limits

- **Catalog size**: capped at 400 entries (`MAX_CATALOG_ENTRIES`). Beyond that the
  catalog stops being a useful prompt and needs a retrieval step — narrow by
  department first.
- **Visually identical SKUs** (two brands of the same juice) will land in the
  0.5–0.85 band and make the clerk ask. That is the correct outcome for a till,
  not a calibration bug to tune away.
- **Latency is variable, and the client waits 15s for it.** Measured against this
  proxy, a look takes roughly 3–8.5 seconds. `REQUEST_TIMEOUT_MS` in
  `claude-vision.adapter.ts` is therefore set to the Lambda's own 15s ceiling and
  not below it: at 8s the till abandoned requests the model went on to answer
  correctly, which bills the shop for the look *and* tells the cashier to try
  again. If that wait is too long for a counter, shrink the frame
  (`CAPTURE_MAX_EDGE`) or lower `EFFORT` — do not put the client's deadline back
  under the server's.
