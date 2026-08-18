/**
 * "Onsen Counter" — the clerk's visual direction, in one file.
 *
 * The obvious palette for a camera UI with a character on it is near-black plus
 * one bright accent, which is also the palette of every other camera UI with a
 * character on it. This one comes from the subject instead: a capybara's own
 * setting is a hot spring, so the counter is a bath — warm dark stone, mineral
 * water, steam, and a yuzu floating beside her.
 *
 * The structure is warm subject / cool field / one warm accent. The cool note is
 * a large desaturated area rather than a bright stripe, which is what keeps it
 * off the default.
 *
 * The Tailwind config mirrors these values for the DOM overlay; canvas can't read
 * CSS custom properties cheaply per frame, so they are literals here and this
 * file is the source of truth for both.
 */
export const ONSEN = {
  /** Stage floor. Warm-black, brown-biased — never a neutral #000. */
  deep: '#14100E',
  /** The bath. Deep mineral teal, used as a field. */
  water: '#1F3A38',
  /** Lighter water toward the surface, for the depth gradient. */
  waterSurface: '#2C544F',
  /** Primary ink on dark, and steam. */
  steam: '#E8DCCB',
  /** The subject. */
  capy: '#A9754B',
  capyLight: '#D9A874',
  capyDark: '#6E4630',
  /** Muzzle and belly — a shade paler than the coat, as on the real animal. */
  capyMuzzle: '#C9A17A',
  /** Nose and eyes. */
  ink: '#241812',
  /** The only accent: the confidence float and primary actions. */
  yuzu: '#F0B429',
  /** Chrome and secondary controls. Deliberately desaturated. */
  kelp: '#4E8C7A',
  /** Undo, stop, out-of-stock. Burnt persimmon, not a pure red. */
  tsuba: '#C4553C',
} as const;

/**
 * The yuzu ripens as confidence rises: unripe green, through amber, to full
 * yuzu yellow at the auto-add threshold. Colour is doing the same job as a
 * progress bar, which is why there is no progress bar.
 */
export const YUZU_RAMP = ['#7FA84E', '#C98F2B', ONSEN.yuzu] as const;

/** Where the water surface sits, as a fraction of stage height. */
export const WATER_LINE = 0.62;

/**
 * The box drawn over a detected barcode.
 *
 * Green and red, because that is the one convention every cashier already knows,
 * but taken from colours the palette already holds rather than bolted on: the
 * green is the unripe yuzu, and the red is the persimmon already used for undo and
 * out-of-stock. Nothing new was introduced to say "yes" and "no".
 */
export const SCAN_BOX = {
  /** In this shop's catalogue — about to be rung up. */
  matched: YUZU_RAMP[0],
  /** A readable code this shop does not sell. */
  unknown: ONSEN.tsuba,
} as const;

/**
 * The pond's other inhabitants — a shoal below the surface and a frog that comes
 * up for a look. Both are drawn deliberately low-contrast against the water: they
 * are there so the bath feels inhabited when you happen to glance at it, not to
 * be looked at. The yuzu is the only thing on this stage allowed to ask for
 * attention.
 */
export const POND_LIFE = {
  /**
   * Pale koi, not dark silhouettes.
   *
   * The intuitive choice is a dark shape — that is what a fish looks like from
   * above in daylight. But this water is already almost black, so dark-on-dark
   * disappears entirely. A pale fish reads immediately, and koi in a bath is the
   * more honest image for the setting anyway.
   */
  fish: ONSEN.steam,
  frogBody: '#4A7A4C',
  frogHead: '#5C8F58',
  frogEye: ONSEN.yuzu,
} as const;
