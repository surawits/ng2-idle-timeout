import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface Feature {
  title: string;
  description: string;
  icon: string;
}

interface ShowcaseItem {
  title: string;
  blurb: string;
  ctaLabel: string;
  routerLink: string;
}

@Component({
  selector: 'experience-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent {
  readonly features: Feature[] = [
    {
      title: 'Resilient Session Tracking',
      description: 'Coordinate session state across browser tabs, service calls, and storage without rewriting business logic.',
      icon: 'bi-shield-lock'
    },
    {
      title: 'Flexible Interactions',
      description: 'React to user intent with configurable idle, warning, and timeout hooks that embrace your UX patterns.',
      icon: 'bi-sliders'
    },
    {
      title: 'Built for Angular',
      description: 'Ship with first-class standalone providers, schematics, and testing utilities for Angular 16 and beyond.',
      icon: 'bi-stack'
    }
  ];

  readonly showcase: ShowcaseItem[] = [
    {
      title: 'Product-ready Documentation',
      blurb: 'Walk through configuration patterns, integration tips, and code snippets crafted for real-world apps.',
      ctaLabel: 'Explore Docs',
      routerLink: '/docs'
    },
    {
      title: 'Interactive Playground',
      blurb: 'Try different idle and timeout profiles, watch events fire, and export the configuration that matches your needs.',
      ctaLabel: 'Open Playground',
      routerLink: '/playground'
    }
  ];

  readonly badges = ['Idle Detection', 'Schematics', 'Auth Guard', 'Interceptor', 'Signals Ready'];
}
