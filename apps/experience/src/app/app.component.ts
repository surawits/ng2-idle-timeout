import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';

interface NavItem {
  label: string;
  routerLink?: string;
  externalUrl?: string;
  target?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  readonly navItems: NavItem[] = [
    { label: 'Home', routerLink: '/' },
    { label: 'Documentation', routerLink: '/docs' },
    { label: 'Playground', routerLink: '/playground' },
    { label: 'FAQ', routerLink: '/faq' },
    { label: 'GitHub', externalUrl: 'https://github.com/ng2-idle-timeout', target: '_blank' }
  ];

  isMenuOpen = false;

  toggleMenu(): void {
    this.isMenuOpen = !this.isMenuOpen;
  }

  closeMenu(): void {
    this.isMenuOpen = false;
  }
}

