/**
 * Embedder calibration.
 *
 * The sample-index tier rests on two claims, and both are worth measuring before
 * anything is built on them:
 *
 *   1. An image embedder actually runs in this project's toolchain.
 *   2. Text and image embeddings share a space, so a product's *name* can be matched
 *      against a *photo* — which is what lets a brand-new SKU be recognised before
 *      anyone has photographed it.
 *
 * Claim 2 is the load-bearing one and the one most likely to be false. If it fails,
 * cold-start seeding from product names gets dropped and the tier simply starts empty
 * — which is today's behaviour, so nothing regresses.
 *
 *   node scripts/vision/calibrate-embedder.mjs
 */
import { RawImage, pipeline } from '@huggingface/transformers';

/** Candidates, best-fit first. Each pairs an image tower with its text tower. */
const CANDIDATES = [
  {
    name: 'nomic-embed-vision-v1.5',
    image: { task: 'image-feature-extraction', model: 'nomic-ai/nomic-embed-vision-v1.5' },
    text: { task: 'feature-extraction', model: 'nomic-ai/nomic-embed-text-v1.5' },
    note: '768-dim, matches the existing pgvector column and the installed Ollama text model',
  },
  {
    name: 'CLIP ViT-B/32',
    image: { task: 'image-feature-extraction', model: 'Xenova/clip-vit-base-patch32' },
    text: { task: 'feature-extraction', model: 'Xenova/clip-vit-base-patch32' },
    note: '512-dim, text and image towers aligned by construction',
  },
];

/** A flat colour block. Crude, but enough to prove the mechanism and the alignment. */
function solid(r, g, b, size = 224) {
  const data = new Uint8ClampedArray(size * size * 3);
  for (let i = 0; i < data.length; i += 3) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return new RawImage(data, size, size, 3);
}

const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

const vec = (out) => Array.from(out.data ?? out);

for (const candidate of CANDIDATES) {
  console.log(`\n=== ${candidate.name} ===`);
  console.log(candidate.note);

  let embedImage;
  try {
    embedImage = await pipeline(candidate.image.task, candidate.image.model);
  } catch (error) {
    console.log(`  IMAGE TOWER UNAVAILABLE: ${String(error).slice(0, 160)}`);
    continue;
  }

  const red = vec(await embedImage(solid(220, 30, 30)));
  const redAgain = vec(await embedImage(solid(220, 30, 30)));
  const blue = vec(await embedImage(solid(30, 60, 220)));

  console.log(`  dimensions            ${red.length}`);
  console.log(`  identical images      ${cosine(red, redAgain).toFixed(4)}  (want ~1.0)`);
  console.log(`  different images      ${cosine(red, blue).toFixed(4)}  (want clearly lower)`);

  let embedText;
  try {
    embedText = await pipeline(candidate.text.task, candidate.text.model);
  } catch (error) {
    console.log(`  TEXT TOWER UNAVAILABLE: ${String(error).slice(0, 160)}`);
    continue;
  }

  const asText = async (s) =>
    vec(await embedText(s, { pooling: 'mean', normalize: true }));
  const redText = await asText('a solid red square');
  const blueText = await asText('a solid blue square');

  if (redText.length !== red.length) {
    console.log(
      `  ALIGNMENT IMPOSSIBLE: text is ${redText.length}-dim, image is ${red.length}-dim`
    );
    continue;
  }

  // The measurement that matters: does a description score higher against the image
  // it describes than against a different one?
  const match = cosine(redText, red);
  const mismatch = cosine(redText, blue);
  const match2 = cosine(blueText, blue);
  const mismatch2 = cosine(blueText, red);
  console.log(`  text->matching image  ${match.toFixed(4)} / ${match2.toFixed(4)}`);
  console.log(`  text->wrong image     ${mismatch.toFixed(4)} / ${mismatch2.toFixed(4)}`);
  const separates = match > mismatch && match2 > mismatch2;
  console.log(`  ALIGNMENT ${separates ? 'HOLDS' : 'DOES NOT HOLD'} — cold-start seeding ${separates ? 'is viable' : 'must be dropped'}`);
}
