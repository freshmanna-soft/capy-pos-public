import { Provider } from '@angular/core';
import { MERCADOPAGO_POINT_PORT } from '@core/application/ports/mercadopago-point.port';
import { MercadoPagoPointAdapter } from '@core/infrastructure/payment/mercadopago-point.adapter';

/**
 * Provider for the Mercado Pago Point (physical card machine) port.
 * Whether a till uses it is decided per terminal (`TerminalRecord.mpPointTerminalId`).
 */
export const MERCADOPAGO_POINT_PROVIDER: Provider = {
  provide: MERCADOPAGO_POINT_PORT,
  useClass: MercadoPagoPointAdapter,
};
