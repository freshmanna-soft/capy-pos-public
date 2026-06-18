import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavigationComponent } from '@shared/ui/organisms/navigation/navigation.component';
import { ToastContainerComponent } from '@shared/ui/toast/toast-container.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavigationComponent, ToastContainerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
