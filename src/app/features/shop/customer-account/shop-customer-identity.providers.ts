import { Provider } from '@angular/core';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { AppIdCustomerAuthAdapter } from '@core/infrastructure/auth/appid-customer-auth.adapter';

/**
 * The customer identity for `/shop`, bound on that route's own `providers`
 * (app.routes.ts) and nowhere app-wide.
 *
 * Same rule as the self-checkout binding before it: `CurrentCustomerService`
 * is `@Injectable()` without `providedIn: 'root'`, so a customer session cannot
 * be resolved — or mistaken for an authorization source — outside the route
 * that serves customers. `app.routes.spec.ts` asserts both halves against an
 * injector built from the real `appConfig.providers`.
 *
 * No pending-registration store: sign-up and its "check your email" state are
 * two views of one modal component, so the registered address is component
 * state, not a cross-route hand-off.
 *
 * /kiosk/shop deliberately does NOT get this. The kiosk is a shared, staff-
 * signed-in device; persisting a customer's App ID session there would hand
 * it to the next shopper at the screen. It keeps its own splash flow.
 */
export const SHOP_CUSTOMER_IDENTITY_PROVIDERS: Provider[] = [
  { provide: CUSTOMER_AUTH_GATEWAY, useClass: AppIdCustomerAuthAdapter },
  CurrentCustomerService,
];
