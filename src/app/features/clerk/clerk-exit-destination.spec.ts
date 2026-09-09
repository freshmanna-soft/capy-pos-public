import {
  CUSTOMER_EXIT_LABEL,
  CUSTOMER_EXIT_PATH,
  STAFF_EXIT_LABEL,
  STAFF_EXIT_PATH,
  clerkCheckoutTarget,
  clerkExitLabel,
  clerkExitPath,
} from './clerk-exit-destination';

describe('clerkExitPath', () => {
  it('sends a cashier back to the till', () => {
    expect(clerkExitPath(true)).toBe(STAFF_EXIT_PATH);
  });

  it('sends an anonymous customer to the customer lane, not the staff login', () => {
    // The regression this guards: /pos is authGuard-ed, so routing an anonymous
    // visitor there lands them on /login — a screen they have no credentials for.
    expect(clerkExitPath(false)).toBe(CUSTOMER_EXIT_PATH);
    expect(clerkExitPath(false)).not.toBe(STAFF_EXIT_PATH);
  });
});

describe('clerkCheckoutTarget', () => {
  it('asks the staff terminal to open its checkout overlay', () => {
    expect(clerkCheckoutTarget(true)).toEqual({
      path: STAFF_EXIT_PATH,
      queryParams: { checkout: 1 },
    });
  });

  it('hands an anonymous customer to the customer lane with no overlay flag', () => {
    // No customer-side payment step exists yet (#218), so the honest destination
    // is the customer lane — never a guarded route with a flag it cannot honour.
    expect(clerkCheckoutTarget(false)).toEqual({ path: CUSTOMER_EXIT_PATH });
  });

  it('never targets a guarded route without a staff session', () => {
    expect(clerkCheckoutTarget(false).path).not.toBe(STAFF_EXIT_PATH);
  });
});

describe('clerkExitLabel', () => {
  it('names the till for a cashier', () => {
    expect(clerkExitLabel(true)).toBe(STAFF_EXIT_LABEL);
  });

  it('does not tell an anonymous customer they are going back to the POS', () => {
    // The regression this guards: the destination became session-aware while the
    // button kept saying "Back to POS", so the one state this story adds got a
    // control naming a till the customer has no access to and is not going to.
    expect(clerkExitLabel(false)).toBe(CUSTOMER_EXIT_LABEL);
    expect(clerkExitLabel(false)).not.toContain('POS');
  });
});

describe('the label and the destination', () => {
  // Paired on purpose. Either one alone can be individually correct while the
  // button as a whole lies, and that mismatch is invisible to a routing-only
  // test — which is exactly how it survived the first round.
  it.each([true, false])('agree about where the button goes (staff: %s)', (isStaff) => {
    const path = clerkExitPath(isStaff);
    const label = clerkExitLabel(isStaff);

    const named = label.includes('POS') ? STAFF_EXIT_PATH : CUSTOMER_EXIT_PATH;
    expect(named, `"${label}" should describe ${path}`).toBe(path);
  });
});
