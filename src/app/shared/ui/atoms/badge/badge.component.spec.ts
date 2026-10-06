import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { BadgeComponent } from './badge.component';

describe('BadgeComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BadgeComponent] });
  });

  it('includes only badge and variant class when size is md (default)', () => {
    const fixture = TestBed.createComponent(BadgeComponent);
    fixture.detectChanges();
    const classes: string = fixture.componentInstance.badgeClasses();
    expect(classes).toContain('badge');
    expect(classes).toContain('badge-primary');
    expect(classes).not.toContain('badge-md');
    expect(classes).not.toContain('badge-dot');
  });

  it.each([
    ['sm', 'badge-sm'],
    ['lg', 'badge-lg'],
  ] as const)('adds %s size class', (size, expectedClass) => {
    const fixture = TestBed.createComponent(BadgeComponent);
    fixture.componentRef.setInput('size', size);
    fixture.detectChanges();
    expect(fixture.componentInstance.badgeClasses()).toContain(expectedClass);
  });

  it('adds badge-dot class when dot is true', () => {
    const fixture = TestBed.createComponent(BadgeComponent);
    fixture.componentRef.setInput('dot', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.badgeClasses()).toContain('badge-dot');
  });

  it('does not add badge-dot class when dot is false', () => {
    const fixture = TestBed.createComponent(BadgeComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.badgeClasses()).not.toContain('badge-dot');
  });

  it('applies both size and dot classes together', () => {
    const fixture = TestBed.createComponent(BadgeComponent);
    fixture.componentRef.setInput('size', 'sm');
    fixture.componentRef.setInput('dot', true);
    fixture.detectChanges();
    const classes = fixture.componentInstance.badgeClasses();
    expect(classes).toContain('badge-sm');
    expect(classes).toContain('badge-dot');
  });

  it('applies the correct variant class', () => {
    const fixture = TestBed.createComponent(BadgeComponent);
    fixture.componentRef.setInput('variant', 'success');
    fixture.detectChanges();
    expect(fixture.componentInstance.badgeClasses()).toContain('badge-success');
  });
});
