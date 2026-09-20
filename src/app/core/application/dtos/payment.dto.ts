export type PaymentMethod = 'cash' | 'card' | 'mobile' | 'paypal';

/** Payment methods offered by the staff checkout overlay. */
export type StaffPaymentMethod = Exclude<PaymentMethod, 'paypal'>;

/** Result of a confirmed payment, independent of the component that collected it. */
export interface PaymentResult {
  readonly method: PaymentMethod;
  readonly amount: number;
  readonly change?: number;
  readonly transactionId: string;
  readonly timestamp: Date;
}
