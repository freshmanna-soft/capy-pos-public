import {
  Directive,
  Input,
  OnDestroy,
  TemplateRef,
  ViewContainerRef,
  effect,
  inject,
} from '@angular/core';
import { Permission } from '@core/domain/auth/permission.constants';
import { CurrentUserService } from '@core/application/auth/current-user.service';

/**
 * HasPermissionDirective
 *
 * Structural directive that conditionally renders its host element based on
 * whether the current operator holds the required permission.
 *
 * Renders when the user HAS the permission; removes the element from the DOM
 * when they do not (or when not authenticated).
 *
 * Usage:
 *   <button *appHasPermission="'inventory:adjust-stock'">Adjust Stock</button>
 *
 * The directive re-evaluates reactively when the current session changes
 * (e.g. after login or logout) because it reads from CurrentUserService signals
 * inside an Angular effect().
 */
@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective implements OnDestroy {
  private readonly templateRef = inject<TemplateRef<unknown>>(TemplateRef);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly currentUser = inject(CurrentUserService);

  private _permission: Permission | null = null;
  private _isVisible = false;

  /**
   * The required permission string.
   * Accepts the typed Permission union or any string for forward-compatibility.
   */
  @Input()
  set appHasPermission(permission: Permission | string) {
    this._permission = permission as Permission;
    this.updateView();
  }

  private readonly _effect = effect(() => {
    // Read the permissions signal to register a reactive dependency.
    // Angular will re-run this effect when the signal value changes.
    void this.currentUser.permissions();
    this.updateView();
  });

  ngOnDestroy(): void {
    this._effect.destroy();
  }

  private updateView(): void {
    if (!this._permission) {
      this.clear();
      return;
    }

    const granted = this.currentUser.hasPermission(this._permission);

    if (granted && !this._isVisible) {
      this.viewContainer.createEmbeddedView(this.templateRef);
      this._isVisible = true;
    } else if (!granted && this._isVisible) {
      this.viewContainer.clear();
      this._isVisible = false;
    }
  }

  private clear(): void {
    this.viewContainer.clear();
    this._isVisible = false;
  }
}
