import { coverRect, roundedPerimeter } from './stage-mapping';

describe('coverRect', () => {
  it('maps the whole frame onto the whole stage when aspects match', () => {
    const rect = coverRect(
      { x: 0, y: 0, width: 1, height: 1 },
      { width: 640, height: 480 },
      { width: 1280, height: 960 }
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 1280, height: 960 });
  });

  it('crops the sides when the stage is narrower than the frame', () => {
    // 4:3 frame on a 1:1 stage: the video is scaled to fill the height and the
    // left and right are cropped evenly, so a box in the middle stays centred.
    const rect = coverRect(
      { x: 0.5, y: 0.5, width: 0, height: 0 },
      { width: 400, height: 300 },
      { width: 300, height: 300 }
    );
    expect(rect.x).toBeCloseTo(150, 5);
    expect(rect.y).toBeCloseTo(150, 5);
  });

  it('crops the top and bottom when the stage is wider than the frame', () => {
    const rect = coverRect(
      { x: 0.5, y: 0.5, width: 0, height: 0 },
      { width: 300, height: 400 },
      { width: 300, height: 300 }
    );
    expect(rect.x).toBeCloseTo(150, 5);
    expect(rect.y).toBeCloseTo(150, 5);
  });

  it('scales a box by the same factor as the video', () => {
    // 16:9 frame on a 4:3 stage. Cover scales by width here (1200/1600 vs 900/900
    // → 0.75 vs 1.0 → the larger, 1.0), so the box grows with the video.
    const rect = coverRect(
      { x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
      { width: 1600, height: 900 },
      { width: 1200, height: 900 }
    );
    // Scale is max(1200/1600, 900/900) = 1, so the rendered video is 1600 wide and
    // 200px is cropped from each side.
    expect(rect.x).toBeCloseTo(-200 + 0.25 * 1600, 5);
    expect(rect.width).toBeCloseTo(800, 5);
    expect(rect.height).toBeCloseTo(450, 5);
  });

  it('keeps a box in the corner of the frame in the corresponding corner', () => {
    const rect = coverRect(
      { x: 0, y: 0, width: 0.1, height: 0.1 },
      { width: 800, height: 600 },
      { width: 800, height: 600 }
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 80, height: 60 });
  });

  it('returns nothing rather than dividing by zero', () => {
    // The first frames after play() report zero dimensions.
    const zero = { x: 0, y: 0, width: 0, height: 0 };
    expect(
      coverRect(
        { x: 0, y: 0, width: 1, height: 1 },
        { width: 0, height: 0 },
        { width: 100, height: 100 }
      )
    ).toEqual(zero);
    expect(
      coverRect(
        { x: 0, y: 0, width: 1, height: 1 },
        { width: 100, height: 100 },
        { width: 0, height: 0 }
      )
    ).toEqual(zero);
  });
});

describe('roundedPerimeter', () => {
  it('is the plain perimeter with no corner radius', () => {
    expect(roundedPerimeter(100, 50, 0)).toBeCloseTo(300, 5);
  });

  it('replaces the corners with one full circle', () => {
    // Straight runs plus 2πr — four quarter-circles make one whole one.
    expect(roundedPerimeter(100, 50, 10)).toBeCloseTo(2 * 80 + 2 * 30 + 2 * Math.PI * 10, 5);
  });

  it('clamps a radius larger than the rectangle', () => {
    // A fully-rounded 100x100 square is a circle of radius 50.
    expect(roundedPerimeter(100, 100, 999)).toBeCloseTo(2 * Math.PI * 50, 5);
  });
});
