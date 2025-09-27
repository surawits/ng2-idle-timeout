import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface FaqGroup {
  title: string;
  badgeClass: string;
  faqs: Array<{ question: string; answer: string }>;
}

@Component({
  selector: 'experience-faq',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './faq.component.html',
  styleUrl: './faq.component.scss'
})
export class FaqComponent {
  readonly groups: FaqGroup[] = [
    {
      title: 'Session Management',
      badgeClass: 'text-bg-primary',
      faqs: [
        {
          question: 'Why do I see NullInjectorError: No provider for HttpClient?',
          answer:
            "The server time utilities rely on Angular's HttpClient. Add provideHttpClient(withInterceptorsFromDi()) to your bootstrap providers (or import HttpClientModule when using NgModules) before registering the sessionTimeoutProviders."
        },
        {
          question: 'Warnings never appear or sessions never expire — what should I check?',
          answer:
            'Confirm idleGraceMs, countdownMs, and warnBeforeMs values are greater than zero and that you call sessionTimeout.start(). Ensure no global pause() call is left hanging and that activity streams are not constantly resetting the timer.'
        },
        {
          question: 'Can I pause or resume sessions manually during long-running work?',
          answer:
            'Yes. Call sessionTimeout.pause() before the work starts and sessionTimeout.resume() when it completes. You can also set resumeBehavior to autoOnServerSync to restart after the next successful heartbeat.'
        }
      ]
    },
    {
      title: 'Usage',
      badgeClass: 'text-bg-success',
      faqs: [
        {
          question: 'How do I coordinate sessions across tabs when BroadcastChannel is unavailable?',
          answer:
            'Enable the localStorage fallback by keeping storageKeyPrefix consistent across tabs. The library will use storage events when BroadcastChannel is missing.'
        },
        {
          question: 'Which configuration values can I override per route?',
          answer:
            'Provide data.sessionTimeout overrides in your route definition to adjust warnBeforeMs, countdownMs, or resumeBehavior for a specific feature area.'
        }
      ]
    },
    {
      title: 'Technical',
      badgeClass: 'text-bg-secondary',
      faqs: [
        {
          question: 'How can I trace session state transitions for debugging?',
          answer:
            'Subscribe to sessionTimeout.events$ to log transitions and use the verbose logging option in SessionTimeoutConfig to emit console diagnostics.'
        },
        {
          question: 'How do custom HTTP interceptors coexist with activity tracking?',
          answer:
            'Provide your interceptors via withInterceptorsFromDi() so the library can compose them. Mark outgoing requests with the session activity context token when you want them to reset idle timers.'
        }
      ]
    }
  ];

  slugify(value: string, index?: number): string {
    const base = value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return index === undefined ? base : `${base}-${index}`;
  }
}
