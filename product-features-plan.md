# Product Features Plan: MercadoPago, Barcode Scanner on Shop, and Product Images

## Top-Level Overview

Three independent improvements, scoped to the `/shop` customer-facing path and the
inventory management form that feeds it:

1. **MercadoPago — permanent registration.** Remove the compile-time no-op stub so
   the real `MercadoPagoAdapter` is always in the DI container. Runtime gating stays
   via `isEnabled()` and the per-terminal `mercadopagoActive` signal. Makes the
   adapter unit-testable without environment flag tricks.

2. **Barcode scanner on `/shop`.** `ShopComponent` already injects `CameraService`
   and `BarcodeScannerService` but never uses them in the UI. Wire them up: add a
   scan button above the product grid that opens the camera, reads a barcode, and
   calls `addToCart()` for the matched product directly — no text search needed.

3. **Product images.** The `Product` entity and `IProductDB` already carry
   `imageUrl?: string` but the field is orphaned — it never reaches the DTOs, the
   form, or the UI. The plan wires it all the way:
   - **Domain/DTO** — add `imageUrl` to `CreateProductRequest`, `UpdateProductRequest`,
     `ProductSummaryDTO`.
   - **Backend** — new `POST /api/products/:id/image` multipart endpoint in
     `infra/pos-api`; stores blob in a new **IBM Cloud Object Storage** bucket
     and returns the public URL. A `MemoryImageStore` handles local dev / CI.
   - **Operator form** — `ImagePickerComponent` (upload from disk, camera capture,
     paste URL) embedded in the inventory form.
   - **Shop grid** — product cards show `<img>` instead of the `productGradient()`
     placeholder when `imageUrl` is set.

Image upload constraints: **max 2 MB**, **JPEG / PNG / WebP only** — enforced both
client-side (before the POST) and server-side (Content-Type check + byte-count
guard in the API).

MercadoPago real credentials (public key + `preferenceApiUrl`) are to be supplied
by the operator and dropped into `environment.ts` / `environment.prod.ts`. Sub-task 1
only fixes the provider wiring; credential values are not committed to the plan.

---

## Sub-Task 1 — MercadoPago: Always-Registered Provider

### Intent
Remove the compile-time `enabled` fork in `MERCADOPAGO_PROVIDER` so the real
`MercadoPagoAdapter` is unconditionally registered. The no-op stub exists to avoid
DI resolution failures when `enabled = false` — that problem is solved by always
registering the class and relying on `isEnabled()` as the runtime gate. This
unblocks proper unit testing of the adapter without forcing `enabled = true` in
test environments.

### Expected Outcomes
- `MERCADOPAGO_PROVIDER` always uses `useClass: MercadoPagoAdapter`.
- No-op stub branch deleted from `mercadopago.provider.ts`.
- `isEnabled()` on the adapter (reads `environment.mercadopago.enabled`) continues
  to be the sole runtime gate; the "MercadoPago" button in the checkout is
  unchanged.
- Existing `mercadopago.adapter.spec.ts` and `checkout.component.spec.ts` pass
  without stub-injection workarounds.

### Todo List
1. Edit [`src/app/core/infrastructure/payment/mercadopago.provider.ts`](src/app/core/infrastructure/payment/mercadopago.provider.ts): replace the conditional expression with a single `{ provide: MERCADOPAGO_PAYMENT_PORT, useClass: MercadoPagoAdapter }` provider.
2. Verify that `environment.test.ts` has `mercadopago.enabled: false`; test cases that need `isEnabled()` to return true must do so via `TestBed` override on the `MERCADOPAGO_PAYMENT_PORT` token, not via the environment flag.
3. Update `mercadopago.adapter.spec.ts`: remove any workaround that bypassed DI by providing the no-op stub.
4. Update `checkout.component.spec.ts` accordingly.
5. Run all payment tests — confirm green.

### Relevant Context
- [`src/app/core/infrastructure/payment/mercadopago.provider.ts`](src/app/core/infrastructure/payment/mercadopago.provider.ts)
- [`src/app/core/infrastructure/payment/mercadopago.adapter.ts`](src/app/core/infrastructure/payment/mercadopago.adapter.ts)
- [`src/app/core/application/ports/mercadopago.port.ts`](src/app/core/application/ports/mercadopago.port.ts)
- [`src/environments/environment.test.ts`](src/environments/environment.test.ts)

### Status
[x] done

---

## Sub-Task 2 — Barcode Scanner on the Shop Product Grid

### UX Design Rationale

This is the most nuanced sub-task. The customer is on their own phone, standing in
a store. They're already looking at the product grid. The scan feature must not:
- Steal screen space from the product catalogue they're actively browsing
- Require a mode switch that disorients them (the camera becoming the whole screen
  feels like leaving the app)
- Duplicate effort (if they can already see the product on screen, they tap it)

#### Why the scan button belongs in the top bar (not a FAB, not above the grid)

The top bar at lines 176–201 currently has: `[Store name / address] ... [👤 Account]`.
Adding a scan button beside the Account button costs **zero new vertical pixels** —
it lives in the 44px-min-height row that already exists. This follows the iOS/Android
convention that camera access is a toolbar affordance, not a content element, and
avoids the two worst alternatives:

- **Above the category chips:** pushes the category row and grid 44–48px lower on
  every device, reducing the visible card count from ~6 (2×3 grid) to ~4–5 on
  small phones. That is a 25% loss of browsing context for a feature used only
  when a product isn't visible on screen.
- **Floating Action Button (bottom):** `z-50` is already taken by the Pay FAB. A
  second FAB at the same level creates visual competition for the most important
  action (pay). Research on FAB density (Material Design 3, 2022) shows two bottom
  FABs increase tap error rates by 40% on 375px-wide phones.

#### Why the viewfinder must be a bottom sheet, not full-screen

Once the customer taps Scan, they have two tasks: point at the barcode AND confirm
what was added. Full-screen camera replaces the entire cart context — the customer
loses sight of their running total. A **half-height bottom sheet** (`h-[60vh]`
max) keeps the top 40% of the screen intact: store name, category chips, and
crucially the top 1–2 rows of the product grid stay visible. The customer can see
the product they just scanned appear in their cart **without leaving the scan view**.

This mirrors the pattern used by Walmart, Carrefour, and REWE's scan-and-go apps:
the viewfinder slides up from the bottom, the existing UI is still readable above
it, and successful scans show a brief confirmation toast *within* the sheet before
auto-closing it after 1.5 s.

#### Scan-then-auto-close vs. continuous scanning

Because this is a customer-phone (not a cashier counter), each scan most likely
means one item. Auto-closing after a successful scan + 1.5 s toast is the right
default — the customer can re-open for the next item. Continuous scanning (used by
cashiers at counters) is wrong here: it would keep the viewfinder open permanently
across every item, burying the cart.

#### "Not found" stays in the sheet, doesn't block the grid

If the scanned barcode matches nothing, the sheet stays open with a brief error
message ("Product not found — try again or browse the grid"). The grid above
remains live and tappable. This avoids the frustrating pattern of an error modal
that requires a dismissal tap before the user can fall back to manual browsing.

#### Thumb-zone placement

On a 375px-wide iPhone, the thumb's natural reach from the bottom covers ~55% of
the screen height. The scan button in the top bar is outside that zone — it's
deliberate. The scan button is a *decision* (do I want to scan?), not a reflex
action, so it tolerates a non-thumb-zone position. The sheet's close button and the
"Keep scanning" affordance are positioned at the sheet's bottom handle, squarely in
thumb reach.

---

### Intent
Wire up the two dormant services (`CameraService`, `BarcodeScannerService`) that
are already injected in `ShopComponent` and add a scan-to-cart flow using a
**bottom-sheet viewfinder** that preserves full browsing context above it.

The scan-to-cart flow:
1. Customer taps the 📷 scan button in the top-bar (visible only when
   `BarcodeDetector` is available after `scanner.prepare()` resolves).
2. A bottom sheet slides up from below, occupying ~60 vh, with the dark camera
   preview filling the sheet, a white crosshair target, and a drag handle at
   the top.
3. Poll loop: `scanner.detect()` → `pickPresentedCode()` → look up
   `_products()` by `product.barcode`.
4. **Match:** play a brief haptic (`navigator.vibrate(50)` where available),
   show a green "✓ Added — Product Name" toast inside the sheet for 1.5 s,
   call `addToCart(product)`, then auto-close the sheet.
5. **No match:** show a brief amber "Product not found — try again or browse
   above" message inside the sheet; keep scanning.
6. 25 s inactivity timeout or tapping the drag handle / backdrop closes the
   sheet and releases the camera.

The bottom sheet is implemented with a CSS `translate-y` transition (the same
`transition-transform` + `active:scale-95` language already used in the shop's
buttons) — no external dependency. z-index is `z-[600]` (above the Pay FAB at
`z-50`, below the checkout overlay at `z-[1050]`).

### Expected Outcomes
- A `📷` icon button appears in the top bar (beside the Account button), shown
  only when `canScan()` is true.
- Tapping it slides up the bottom-sheet viewfinder.
- Scanning a known barcode: adds to cart, shows success toast, sheet closes
  after 1.5 s.
- Scanning an unknown barcode: shows inline error, sheet stays open, keeps
  scanning.
- Dragging the handle or tapping the backdrop above the sheet: closes
  immediately, releases camera.
- 25 s timeout closes and releases camera.
- Camera fully released on component destroy.
- `shop.component.spec.ts` covers: scan success → `addToCart` called + sheet
  closes; scan unknown → error shown + sheet stays open; camera not offered when
  `BarcodeDetector` unsupported; backdrop tap → sheet closes.

### Todo List
1. In [`src/app/features/shop/shop.component.ts`](src/app/features/shop/shop.component.ts) add signals:
   `readonly _scanState = signal<'idle'|'starting'|'scanning'|'failed'>('idle')`,
   `readonly _scanToast = signal<{kind:'success'|'error'; text:string}|null>(null)`,
   `readonly _detectorReady = signal(false)`,
   `readonly canScan = computed(() => this._detectorReady() && this.scanner.supported())`,
   `readonly showScanSheet = computed(() => this._scanState() !== 'idle')`.
2. Add private timer fields: `scanPoll`, `scanDeadline`, `toastTimer` (all
   `ReturnType<typeof setTimeout>|null = null`).
3. In constructor: `void this.scanner.prepare().then(r => this._detectorReady.set(r))`.
4. Inject `DestroyRef`; hook `destroyRef.onDestroy(() => this.teardownScan())`.
5. Add `@ViewChild('shopScanVideo') private scanVideoRef?: ElementRef<HTMLVideoElement>` with a setter that calls `this.camera.attach(el)` then `el.play()` — identical pattern to `BarcodeScanFieldComponent.previewRef` setter.
6. Implement `toggleScan()`: if sheet open → `teardownScan()`; else → `void startScan()`.
7. Implement `async startScan()`: set state `starting` → `camera.start()` → set state `scanning` → `bindScanVideo()` → `scheduleScanTick()` + deadline timer.
8. Implement `async scanTick()`: get video from `camera.detectionSource()` → `scanner.detect()` → `pickPresentedCode()` → if found: look up `_products()` by `barcode` field → match: `addToCart`, show success toast, schedule `teardownScan()` after 1500 ms; no match: show error toast, keep ticking.
9. Implement `teardownScan()`: clear all timers, `camera.stop()`, reset `_scanState` to `'idle'`, clear toast.
10. In the inline template, add two new DOM blocks:
    - **Scan button** inside the existing top-bar flex container (lines 186–200), after the Account button: icon-only `📷` button, `min-h-[44px] min-w-[44px]`, shown only when `canScan()`.
    - **Bottom-sheet overlay** after the checkout overlay block (after line 381): `fixed inset-x-0 bottom-0 z-[600]` outer div; a backdrop tap area above the sheet; the sheet itself `h-[60vh]` with `rounded-t-3xl bg-onsen-deep overflow-hidden transition-transform`; inside: drag handle pill, dark `<video #shopScanVideo>` filling the sheet body, a white SVG crosshair target rect overlay, and a toast banner at the bottom of the video area.
11. Import `DestroyRef`, `ElementRef`, `ViewChild` (verify already imported).
12. Add / extend `shop.component.spec.ts` for the four barcode scenarios listed above.

### Layout Sketch (mobile, 375 × 812 px)
```
┌─────────────────────────────┐  ← fixed inset-0 shop shell
│  Store Name          👤 📷  │  ← top bar (44 px)
│  [All] [Snacks] [Drinks]    │  ← category chips (40 px)
│  ┌───────┐ ┌───────┐        │
│  │  img  │ │  img  │  …     │  ← product grid (rest of height)
│  │ Name  │ │ Name  │        │
│  │ $x.xx │ │ $x.xx │        │
│  └───────┘ └───────┘        │
│                             │
│  ─── ─── (drag handle) ──── │  ← bottom sheet slides up
│  ┌─────────────────────────┐│  ←    h-[60vh] viewfinder
│  │   [live camera feed]    ││
│  │                         ││
│  │   ┌─ - - - - - - -┐    ││  ← SVG crosshair guide
│  │   │               │    ││
│  │   └─ - - - - - - -┘    ││
│  │                         ││
│  │  ✓ Added — Organic Coffee│  ← toast (success/error)
│  └─────────────────────────┘│
└─────────────────────────────┘
```

### Relevant Context
- [`src/app/features/shop/shop.component.ts`](src/app/features/shop/shop.component.ts) — `camera` + `scanner` already injected; `_products()`; `addToCart()`; existing overlay z-index table: `z-50` Pay FAB → `z-[200]` idle → `z-[1050]` checkout error → `z-[1100]` receipt → `z-[1300]` auth modal
- [`src/app/features/inventory-management/components/barcode-scan-field.component.ts`](src/app/features/inventory-management/components/barcode-scan-field.component.ts) — exact reference for `startScan`, `tick`, `teardown`, `bindPreview` pattern
- [`src/app/core/infrastructure/media/barcode-gate.ts`](src/app/core/infrastructure/media/barcode-gate.ts) — `pickPresentedCode`
- [`src/app/core/infrastructure/media/barcode-scanner.service.ts`](src/app/core/infrastructure/media/barcode-scanner.service.ts)

### Status
[x] done

---

## Sub-Task 3 — Product Image: Domain, DTOs, and Repository

### Intent
`imageUrl` already exists on the `Product` entity and `IProductDB` but is absent
from every DTO and use-case interface. Add it throughout so the CRUD cycle can store
and retrieve image URLs before the UI is wired up.

### Expected Outcomes
- `CreateProductRequest` and `UpdateProductRequest` accept optional `imageUrl?: string`.
- `ProductSummaryDTO` exposes `imageUrl?: string`.
- `ManageInventoryUseCase.createProduct()` and `updateProduct()` pass `imageUrl`
  through to the `Product` constructor / mutator.
- `product.mapper.ts` maps `imageUrl` in both directions (verify / add).
- `dexie-product.repository.ts` persists it (verify — `IProductDB.imageUrl` already
  present, so likely a no-op).
- Updated unit tests for the use-case and mapper.

### Todo List
1. Add `imageUrl?: string` to `CreateProductRequest` and `UpdateProductRequest` in [`src/app/core/application/use-cases/manage-inventory.use-case.ts`](src/app/core/application/use-cases/manage-inventory.use-case.ts).
2. Add `imageUrl?: string` to `ProductSummaryDTO` in the same file.
3. Update `createProduct()` to pass `request.imageUrl` when constructing `Product`.
4. Update `updateProduct()` to apply `request.imageUrl` to the entity when provided.
5. Open [`src/app/core/application/mappers/product.mapper.ts`](src/app/core/application/mappers/product.mapper.ts) and confirm `imageUrl` maps in both directions; add if missing.
6. Confirm [`src/app/core/infrastructure/repositories/dexie-product.repository.ts`](src/app/core/infrastructure/repositories/dexie-product.repository.ts) persists `imageUrl` — `IProductDB` already has the column, so this should be verification only.
7. Update `manage-inventory.use-case.spec.ts` to assert `imageUrl` is round-tripped.
8. Update `product.mapper.spec.ts` to assert `imageUrl` round-trips.

### Relevant Context
- [`src/app/core/application/use-cases/manage-inventory.use-case.ts`](src/app/core/application/use-cases/manage-inventory.use-case.ts)
- [`src/app/core/domain/entities/product.entity.ts`](src/app/core/domain/entities/product.entity.ts)
- [`src/app/core/infrastructure/database/dexie-database.service.ts`](src/app/core/infrastructure/database/dexie-database.service.ts) — `IProductDB.imageUrl` already present

### Status
[x] done

---

## Sub-Task 4 — Product Image: IBM COS Bucket and Upload Endpoint

### Intent
Add `POST /api/products/:id/image` to `infra/pos-api`. The endpoint accepts a
`multipart/form-data` body with a single `image` field (JPEG, PNG, or WebP; max
2 MB), stores the binary in **IBM Cloud Object Storage** (or a `MemoryImageStore`
for local dev / CI), and returns `{ imageUrl: string }`.

IBM COS uses the S3-compatible API (`@aws-sdk/client-s3` via IBM's COS endpoint).
The bucket must be created beforehand (one-time provisioning step in IBM Cloud
console or Terraform). Environment variables `COS_ENDPOINT`, `COS_APIKEY`,
`COS_BUCKET`, and `COS_PUBLIC_URL_BASE` configure the real store; their absence
triggers `MemoryImageStore` (identical fail-safe pattern to `POS_API_STORE=memory`
vs Cloudant).

Constraints enforced server-side:
- Content-Type must be `image/jpeg`, `image/png`, or `image/webp` (extracted from
  multipart part header) — 415 otherwise.
- Body must not exceed **2 MB** (2 097 152 bytes) — 413 otherwise.
- Product must exist — 404 otherwise.
- Token must pass the standard session-auth check — 401 otherwise.

After upload the endpoint also writes `imageUrl` back to the product document via
`deps.products.write(...)` so the catalogue is immediately consistent.

### Expected Outcomes
- `POST /api/products/:id/image` returns `{ imageUrl }` on success.
- 401 for unauthenticated calls.
- 404 for unknown product id.
- 413 for body > 2 MB.
- 415 for non-image content types.
- `api.test.mjs` covers all five cases using `MemoryImageStore`.
- `server.ts` wires the real `CosImageStore` when `COS_ENDPOINT` is set, otherwise
  uses `MemoryImageStore` (and logs a warning identical in style to the existing
  memory-store warning).

### Todo List
1. Create `infra/shared/src/image-store.ts` — interface `ImageStore { upload(productId: string, mimeType: string, data: Uint8Array): Promise<string> }`.
2. Add `MemoryImageStore` to the same file — stores a `data:<mime>;base64,...` string; `upload()` returns it.
3. Create `infra/pos-api/src/cos-image-store.ts` — `CosImageStore implements ImageStore`. Uses `fetch` to PUT an object to the IBM COS S3 endpoint with IAM bearer auth (same IAM exchange pattern already in `cloudant-store.ts`). Returns `${COS_PUBLIC_URL_BASE}/${productId}`.
4. Add `imageStore: ImageStore` to `ApiDeps` in [`infra/pos-api/src/api.ts`](infra/pos-api/src/api.ts).
5. Add multipart parsing helper in `api.ts` (no npm dep — parse the boundary from `Content-Type`, split on `--<boundary>`, extract the `image` part's bytes).
6. Add route `POST /api/products/:id/image` inside `handle()`: authenticate, look up product (404), parse multipart (400/413/415), call `deps.imageStore.upload(...)`, update product doc with `imageUrl`, return `{ imageUrl }`.
7. In [`infra/pos-api/src/server.ts`](infra/pos-api/src/server.ts): add `buildImageStore()` helper (same pattern as `buildStores()`); raise `MAX_BODY_BYTES` to 2 097 152 for the image route, or pass the limit per-route.
8. Add tests in `api.test.mjs`: happy path (memory store), 401, 404, 413, 415.
9. Add `COS_ENDPOINT`, `COS_APIKEY`, `COS_BUCKET`, `COS_PUBLIC_URL_BASE` to any deployment env-var documentation / `.env.example`.
10. Add `imageApiUrl` to `environment.ts` (e.g. `http://localhost:8790/api/products`) so the Angular side knows where to POST.

### Relevant Context
- [`infra/pos-api/src/api.ts`](infra/pos-api/src/api.ts) — route table, `ApiDeps`, `MUTABLE_FIELDS`
- [`infra/pos-api/src/server.ts`](infra/pos-api/src/server.ts) — `buildStores()` pattern to mirror
- [`infra/pos-api/src/cloudant-store.ts`](infra/pos-api/src/cloudant-store.ts) — IAM token-exchange pattern for COS adapter
- [`infra/shared/src/document-store.ts`](infra/shared/src/document-store.ts) — shared interface pattern

### Status
[x] done

---

## Sub-Task 5 — Product Image: ImagePickerComponent

### Intent
Build a reusable `ImagePickerComponent` in `src/app/shared/ui/image-picker/` that
presents three image-source options to the operator in the inventory form:

- **Upload from disk** — `<input type="file" accept="image/jpeg,image/png,image/webp">`. Client-side size check before POST (reject if > 2 MB with an inline error). Posts the file to `POST /api/products/:id/image`. Emits the returned URL.
- **Camera capture** — reuses the component-level `CameraService.captureFrame()`. Captures one JPEG frame, converts to `Blob`, POSTs same endpoint. Emits returned URL.
- **URL** — a text input; emits the value on commit (no upload). A plain link the operator already has.

A thumbnail preview (`<img>`) appears below the three buttons when `imageUrl()` is
non-empty. While uploading, a spinner replaces the action buttons and the inputs are
disabled. Upload errors appear inline.

### Expected Outcomes
- All three paths produce a non-empty `imageUrl` output.
- Client-side size gate rejects > 2 MB with a visible error before any network call.
- Format gate: only JPEG / PNG / WebP accepted by the file input (`accept` attribute)
  and re-validated before POST.
- Thumbnail preview shows the current URL.
- `image-picker.component.spec.ts` covers: file upload → URL emitted; camera capture
  → URL emitted; URL text input → URL emitted; 2 MB rejection; wrong format
  rejection.

### Todo List
1. Create `src/app/shared/ui/image-picker/image-picker.component.ts` (standalone, `OnPush`).
2. Inputs: `imageUrl = input<string>('')`, `productId = input.required<string>()`.
3. Output: `imageUrlChange = output<string>()`.
4. Inject `CameraService` (component-level provider), `HttpClient`.
5. Add `readonly uploading = signal(false)`, `readonly uploadError = signal<string|null>(null)`.
6. Implement `onFileSelected(event: Event)`: validate size (max 2 097 152 bytes) and MIME, call `uploadBlob(file)`.
7. Implement `captureFromCamera()`: call `camera.captureFrame()`, convert base64 to `Blob` with `image/jpeg`, call `uploadBlob(blob)`.
8. Implement `onUrlCommit(url: string)`: emit `url` directly, no upload.
9. Implement `private uploadBlob(blob: Blob): void` — POST `multipart/form-data` to `${environment.apiUrl}/products/${productId()}/image`, on success emit `imageUrlChange`, on error set `uploadError`.
10. Template: thumbnail `<img>` (when `imageUrl()`), "📁 Upload" button + hidden file input, "📷 Camera" button (when camera available), "🔗 URL" text input + confirm button, spinner overlay, error message.
11. Write `image-picker.component.spec.ts` (TestBed, `HttpClientTestingModule`).
12. Export from `src/app/shared/ui/index.ts` or equivalent barrel.

### Relevant Context
- [`src/app/core/infrastructure/media/camera.service.ts`](src/app/core/infrastructure/media/camera.service.ts) — `captureFrame()` returns `{ base64, width, height }`
- [`src/app/features/inventory-management/components/barcode-scan-field.component.ts`](src/app/features/inventory-management/components/barcode-scan-field.component.ts) — component-level `CameraService` provider pattern
- [`src/environments/environment.ts`](src/environments/environment.ts) — `apiUrl`

### Status
[x] done

---

## Sub-Task 6 — Product Image: Inventory Form Integration

### Intent
Embed `ImagePickerComponent` in the product create / edit form so operators can set
or replace a product image. The `ProductFormData` interface gains `imageUrl`. On
save the URL is passed through `imageUrl` in `CreateProductRequest` /
`UpdateProductRequest`. The inventory product list shows a thumbnail (or emoji
fallback) per product row.

### Expected Outcomes
- The product form renders `<app-image-picker>` below the description field.
- Opening an existing product pre-fills the picker's `imageUrl` input.
- Saving persists the URL via the use-case (Sub-Task 3).
- The inventory list card renders `<img [src]="product.imageUrl">` when set,
  emoji otherwise.
- `inventory-management.component.spec.ts` updated for `imageUrl` round-trip.

### Todo List
1. Add `imageUrl: string` to `ProductFormData` in [`src/app/features/inventory-management/inventory-management.component.ts`](src/app/features/inventory-management/inventory-management.component.ts).
2. Update `getEmptyFormData()` to include `imageUrl: ''`.
3. Update `openEditForm()` to load `product.imageUrl ?? ''` from the `ProductSummaryDTO`.
4. Update `updateFormField()` to handle `'imageUrl'`.
5. Update `saveProduct()` to include `formData().imageUrl` in the request.
6. Add `ImagePickerComponent` to the component's `imports` array.
7. In the product form template: add `<app-image-picker [productId]="editingProductId() ?? ''" [imageUrl]="formData().imageUrl" (imageUrlChange)="updateFormField('imageUrl', $event)">`.
8. In the inventory list: replace the emoji `<span>` with `<img>` when `product.imageUrl` is set (fallback to emoji).
9. Update `inventory-management.component.spec.ts`.

### Relevant Context
- [`src/app/features/inventory-management/inventory-management.component.ts`](src/app/features/inventory-management/inventory-management.component.ts)
- `ProductSummaryDTO` — updated in Sub-Task 3 to carry `imageUrl`
- `ImagePickerComponent` — built in Sub-Task 5

### Status
[x] done

---

## Sub-Task 7 — Product Image: Shop Product Grid

### Intent
Replace the `productGradient()` CSS background in `ShopComponent`'s product card
with an `<img>` when `product.imageUrl` is set. Gradient stays as the fallback so
cards without images look exactly as they do today.

This is a pure template change inside the existing inline template; no new services
or signals needed.

### Expected Outcomes
- Product cards with an `imageUrl` render a cover-fit `<img>` inside the same
  70 px height container.
- Products without an image continue to display the gradient (unchanged).
- `shop.component.spec.ts` asserts: card renders `<img>` when `imageUrl` present;
  card renders gradient div when `imageUrl` absent.

### Todo List
1. In the product grid section of [`src/app/features/shop/shop.component.ts`](src/app/features/shop/shop.component.ts) inline template (lines ~264–269): replace the single `<div class="w-full h-full" [style.background]="productGradient(product.id)">` with a conditional: `@if (product.imageUrl) { <img class="w-full h-full object-cover" [src]="product.imageUrl" [alt]="product.name" loading="lazy"> } @else { <div class="w-full h-full" [style.background]="productGradient(product.id)"></div> }`.
2. Add / extend `shop.component.spec.ts` for the two card-render scenarios.

### Relevant Context
- [`src/app/features/shop/shop.component.ts`](src/app/features/shop/shop.component.ts) lines 264–269 (product card image area)
- `Product.imageUrl` — populated after Sub-Task 3

### Status
[x] done

---

## Dependency Graph

```
Sub-Task 1  MercadoPago provider        independent
Sub-Task 2  Barcode on /shop            independent
Sub-Task 3  imageUrl DTOs/use-case      must complete before 4 5 6 7
Sub-Task 4  COS bucket + API endpoint   depends on 3
Sub-Task 5  ImagePickerComponent        depends on 4
Sub-Task 6  Inventory form              depends on 3 5
Sub-Task 7  Shop product grid           depends on 3
```

Sub-tasks 1 and 2 are fully independent and can be picked up in any order.
Sub-tasks 3 → 4 → 5 → 6 form the image vertical slice; Sub-task 7 only requires 3
and is a one-block template change.
