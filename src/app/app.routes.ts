import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'pos',
    pathMatch: 'full'
  },
  {
    path: 'pos',
    loadComponent: () =>
      import('./features/pos-terminal/pos-terminal.component').then(m => m.PosTerminalComponent),
    title: 'POS Terminal'
  },
  {
    path: 'dashboard',
    loadComponent: () =>
      import('./features/dashboard/agent-monitor/agent-monitor.component').then(m => m.AgentMonitorComponent),
    title: 'Agent Dashboard'
  },
  {
    path: '**',
    redirectTo: 'pos'
  }
];
