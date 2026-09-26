import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with an empty toast list', () => {
    expect(service.toasts()).toHaveLength(0);
  });

  it('success() adds a toast with variant success', () => {
    service.success('Saved');
    expect(service.toasts()).toHaveLength(1);
    expect(service.toasts()[0]).toMatchObject({ message: 'Saved', variant: 'success' });
  });

  it('error() adds a toast with variant error', () => {
    service.error('Something went wrong');
    expect(service.toasts()[0]).toMatchObject({ variant: 'error' });
  });

  it('warning() adds a toast with variant warning', () => {
    service.warning('Heads up');
    expect(service.toasts()[0]).toMatchObject({ variant: 'warning' });
  });

  it('info() adds a toast with variant info', () => {
    service.info('FYI');
    expect(service.toasts()[0]).toMatchObject({ message: 'FYI', variant: 'info' });
  });

  it('auto-dismisses a toast after its default duration', () => {
    service.success('Auto-dismiss me');
    expect(service.toasts()).toHaveLength(1);

    vi.advanceTimersByTime(2500);

    expect(service.toasts()).toHaveLength(0);
  });

  it('keeps a toast indefinitely when duration <= 0', () => {
    service.show('Sticky', 'info', 0);
    vi.advanceTimersByTime(60_000);
    expect(service.toasts()).toHaveLength(1);
  });

  it('dismiss() removes only the targeted toast', () => {
    const id1 = service.success('First');
    service.error('Second');

    service.dismiss(id1);

    expect(service.toasts()).toHaveLength(1);
    expect(service.toasts()[0]).toMatchObject({ variant: 'error' });
  });

  it('clear() removes all toasts at once', () => {
    service.success('A');
    service.error('B');
    service.warning('C');
    expect(service.toasts()).toHaveLength(3);

    service.clear();

    expect(service.toasts()).toHaveLength(0);
  });

  it('caps the visible stack at 4 toasts', () => {
    service.show('1', 'info', 0);
    service.show('2', 'info', 0);
    service.show('3', 'info', 0);
    service.show('4', 'info', 0);
    service.show('5', 'info', 0);

    const toasts = service.toasts();
    expect(toasts).toHaveLength(4);
    expect(toasts[0].message).toBe('2');
    expect(toasts[3].message).toBe('5');
  });

  it('show() returns the toast id', () => {
    const id = service.show('Hello', 'success', 0);
    expect(typeof id).toBe('number');
    expect(id).toBeGreaterThan(0);
  });

  it('keeps toast when duration is negative', () => {
    service.show('Negative TTL', 'warning', -1);
    vi.advanceTimersByTime(60_000);
    expect(service.toasts()).toHaveLength(1);
  });
});
