import { Provider } from '@angular/core';
import { ICartService } from './cart.service.interface';
import { CartService } from './cart.service';

/**
 * Provides the CartService implementation for dependency injection.
 * Use this provider when you need to inject ICartService.
 * 
 * @example
 * ```typescript
 * @Component({
 *   providers: [provideCartService()]
 * })
 * export class MyComponent {
 *   constructor(private cartService: ICartService) {}
 * }
 * ```
 */
export function provideCartService(): Provider {
  return {
    provide: 'ICartService',
    useClass: CartService
  };
}

/**
 * Token for injecting ICartService.
 * Use this with @Inject() decorator.
 * 
 * @example
 * ```typescript
 * constructor(@Inject(CART_SERVICE_TOKEN) private cartService: ICartService) {}
 * ```
 */
export const CART_SERVICE_TOKEN = 'ICartService';

// Made with Bob
