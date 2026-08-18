/** A rectangle in normalised frame coordinates (0..1 of width and height). */
export interface NormalisedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A rectangle in stage pixels. */
export interface StageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Place a rectangle from the camera frame onto the stage.
 *
 * The video is rendered `object-cover`: scaled to fill the stage and centre-cropped
 * on whichever axis overflows. Anything drawn over it has to repeat that transform
 * exactly or the box sits beside the barcode instead of on it — and the error is
 * invisible when the aspect ratios happen to match, which is precisely when
 * developing, so it has to be got right by construction rather than by eye.
 *
 * @param rect Bounds in normalised frame coordinates.
 * @param frame Intrinsic video size. A zero dimension yields a zero rect rather
 *   than dividing by it — the first frames after `play()` report zero.
 */
export function coverRect(
  rect: NormalisedRect,
  frame: { width: number; height: number },
  stage: { width: number; height: number }
): StageRect {
  if (frame.width <= 0 || frame.height <= 0 || stage.width <= 0 || stage.height <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  // `cover` scales by the larger ratio so neither axis leaves a gap.
  const scale = Math.max(stage.width / frame.width, stage.height / frame.height);
  const rendered = { width: frame.width * scale, height: frame.height * scale };
  // Whatever overflows is cropped evenly from both sides.
  const offsetX = (stage.width - rendered.width) / 2;
  const offsetY = (stage.height - rendered.height) / 2;

  return {
    x: offsetX + rect.x * rendered.width,
    y: offsetY + rect.y * rendered.height,
    width: rect.width * rendered.width,
    height: rect.height * rendered.height,
  };
}

/**
 * Perimeter of a rounded rectangle: the straight runs plus one full circle's worth
 * of corner. Used to length the progress ring's dash, so the stroke it draws is
 * proportional to the progress it is reporting.
 */
export function roundedPerimeter(width: number, height: number, radius: number): number {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  return 2 * (width - 2 * r) + 2 * (height - 2 * r) + 2 * Math.PI * r;
}
