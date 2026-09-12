import { PendingRegistrationStore } from './pending-registration.store';

/**
 * Two properties, and both are the reason this exists rather than a query param:
 * the address is *held* (so the interstitial can name the inbox) and it is
 * *forgotten on read* (so a shared in-store terminal does not keep it around for
 * the next shopper).
 */
describe('PendingRegistrationStore', () => {
  it('holds nothing until a registration is remembered', () => {
    expect(new PendingRegistrationStore().take()).toBeNull();
  });

  it('hands the remembered address to the first reader', () => {
    const store = new PendingRegistrationStore();

    store.remember('yuzu@example.com');

    expect(store.take()).toBe('yuzu@example.com');
  });

  it('forgets the address as it reads it', () => {
    // The whole point of `take` over a getter: a reload of the interstitial, or a
    // shopper who walks away leaving it on screen, must not surface the previous
    // customer's address. Turning this into a plain read fails here.
    const store = new PendingRegistrationStore();
    store.remember('yuzu@example.com');

    store.take();

    expect(store.take()).toBeNull();
  });

  it('keeps only the most recent registration', () => {
    const store = new PendingRegistrationStore();

    store.remember('first@example.com');
    store.remember('second@example.com');

    expect(store.take()).toBe('second@example.com');
  });
});
