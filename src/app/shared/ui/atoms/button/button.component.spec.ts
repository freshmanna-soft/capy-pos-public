import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ButtonComponent } from './button.component';

describe('ButtonComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ButtonComponent] });
  });

  it('includes btn and variant class by default', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
    const classes = fixture.componentInstance.buttonClasses();
    expect(classes).toContain('btn');
    expect(classes).toContain('btn-primary');
    expect(classes).not.toContain('w-full');
  });

  it('adds size class when size is not md', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('size', 'sm');
    fixture.detectChanges();
    expect(fixture.componentInstance.buttonClasses()).toContain('btn-sm');
  });

  it('adds w-full class when fullWidth is true', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('fullWidth', true);
    fixture.detectChanges();
    expect(fixture.componentInstance.buttonClasses()).toContain('w-full');
  });

  it('does not add w-full class when fullWidth is false (default)', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
    expect(fixture.componentInstance.buttonClasses()).not.toContain('w-full');
  });

  it('emits clicked event when not disabled and not loading', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    const emitSpy = vi.spyOn(comp.clicked, 'emit');
    const event = new MouseEvent('click');

    comp.handleClick(event);

    expect(emitSpy).toHaveBeenCalledWith(event);
  });

  it('does not emit clicked event when disabled', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    const emitSpy = vi.spyOn(comp.clicked, 'emit');

    comp.handleClick(new MouseEvent('click'));

    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('does not emit clicked event when loading', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    const comp = fixture.componentInstance;
    const emitSpy = vi.spyOn(comp.clicked, 'emit');

    comp.handleClick(new MouseEvent('click'));

    expect(emitSpy).not.toHaveBeenCalled();
  });
});
