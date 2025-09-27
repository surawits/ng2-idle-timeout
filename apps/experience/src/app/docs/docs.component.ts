import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'experience-docs',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './docs.component.html',
  styleUrl: './docs.component.scss'
})
export class DocsComponent {
  readonly installCommands = [
    'npm install ng2-idle-timeout',
    'ng add ng2-idle-timeout-ng-add'
  ];

  readonly heroBadges = ['Angular 16+', 'Standalone-first', 'Signals ready'];

  readonly scripts = [
    { command: 'npm run build --workspace=ng2-idle-timeout', description: 'Build library with ng-packagr' },
    { command: 'npm run test --workspace=ng2-idle-timeout', description: 'Run Jest suite for services, guards, interceptors' },
    { command: 'npm run demo:start', description: 'Launch this documentation & playground app' }
  ];

  readonly providerSnippet = `// session-timeout.providers.ts
import { SESSION_TIMEOUT_CONFIG, SessionTimeoutService } from 'ng2-idle-timeout';

export const sessionTimeoutProviders = [
  SessionTimeoutService,
  {
    provide: SESSION_TIMEOUT_CONFIG,
    useValue: {
      storageKeyPrefix: 'app-session',
      warnBeforeMs: 60000,
      resumeBehavior: 'autoOnServerSync'
    }
  }
];`;

  readonly configSnippet = `// app.config.ts
import { provideRouter } from '@angular/router';
import { sessionTimeoutProviders } from './session-timeout.providers';

export const appConfig = {
  providers: [
    provideRouter(routes),
    ...sessionTimeoutProviders
  ]
};`;

  async copy(command: string): Promise<void> {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(command);
      } catch (error) {
        console.warn('Clipboard API rejected copy request', error);
      }
    }
  }
}
