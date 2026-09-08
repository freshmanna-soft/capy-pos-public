/**
 * "Onsen Counter, customer side" — the self-checkout lane's tokens, in one file.
 *
 * The lane is the same bathhouse as `/clerk`, so the hues come from the same
 * "Onsen Counter" direction. It does not import
 * `clerk/canvas/capybara-palette.ts`: that file exists because canvas cannot read
 * CSS custom properties cheaply per frame, and it is shaped around drawing a
 * mascot (coat, muzzle, ink, confidence ramp). This lane is a plain form-based UI
 * whose roles are surfaces, ink and one call to action, and coupling a customer
 * form to the renderer's palette would mean every mascot tweak reaching into it.
 *
 * The values are the DOM mirror already in `tailwind.config.js`, so the classes
 * used in the templates (`bg-onsen-deep`, `text-steam`, `text-yuzu`, `text-kelp`)
 * resolve to exactly these. They are named by role here, not by hue, so the
 * later items (sign-up, sign-in, scan-to-cart) have somewhere to hang.
 */
export const SELF_CHECKOUT_PALETTE = {
  /** Lane background. Warm-black, brown-biased — never a neutral #000. */
  surface: '#14100E',
  /** Raised panels: cards, form wells. Deep mineral teal. */
  panel: '#1F3A38',
  /** Panel edges and dividers, at low opacity in the templates. */
  panelEdge: '#2C544F',
  /** Primary ink on the lane. */
  ink: '#E8DCCB',
  /** Labels, hints, chrome. Deliberately desaturated. */
  inkMuted: '#4E8C7A',
  /** The only accent: primary actions and focus rings. */
  accent: '#F0B429',
  /** Errors and stop states. Burnt persimmon, not a pure red. */
  danger: '#C4553C',
} as const;

/** Title shown by the router and by the lane's own header. */
export const SELF_CHECKOUT_TITLE = 'Self-Checkout · Capy-POS';
