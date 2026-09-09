import {
  CUSTOMER_EXIT_PATH,
  STAFF_EXIT_PATH,
  clerkCheckoutTarget,
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
