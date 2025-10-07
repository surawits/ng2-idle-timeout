import { DOCUMENT } from '@angular/common';
import { Injectable, inject } from '@angular/core';
import type { HttpContext, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import type { Observable } from 'rxjs';

import { LeaderElectionService } from '../services/leader-election.service';
import { SessionTimeoutService } from '../services/session-timeout.service';
import type { SessionTimeoutConfig } from '../models/session-timeout-config';
import { getSessionActivityContextToken } from './session-activity-http.context';

@Injectable()
export class SessionActivityHttpInterceptor implements HttpInterceptor {
  private readonly bootstrappedAt = Date.now();
  private cooldownUntil = 0;
  private readonly sessionTimeout = inject(SessionTimeoutService);
  private readonly leaderElection = inject(LeaderElectionService, { optional: true });
  private readonly document = inject(DOCUMENT, { optional: true }) as Document | null;

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const config = this.sessionTimeout.getConfig();
    if (this.shouldTreatAsActivity(req, config)) {
      const meta = {
        method: req.method,
        url: req.urlWithParams,
        strategy: config.httpActivity.strategy
      } satisfies Record<string, unknown>;
      this.sessionTimeout.resetIdle(meta, { source: 'http' });
    }

    return next.handle(req);
  }

  private shouldTreatAsActivity(req: HttpRequest<unknown>, config: SessionTimeoutConfig): boolean {
    const policy = config.httpActivity;
    if (!policy.enabled) {
      return false;
    }

    if (config.strategy === 'userOnly') {
      return false;
    }

    const now = Date.now();

    if (policy.ignoreOnInitMs > 0 && now - this.bootstrappedAt < policy.ignoreOnInitMs) {
      return false;
    }

    if (policy.cooldownMs > 0 && now < this.cooldownUntil) {
      return false;
    }

    if (policy.onlyWhenTabFocused && !this.isDocumentFocused()) {
      return false;
    }

    if (policy.primaryTabOnly && this.leaderElection && !this.leaderElection.isLeader()) {
      return false;
    }

    const url = req.urlWithParams;
    if (policy.denylist.some(pattern => this.matches(pattern, url))) {
      return false;
    }

    let shouldReset = false;

    switch (policy.strategy) {
      case 'allowlist':
        shouldReset = this.matchesAllowlist(req, policy);
        break;
      case 'headerFlag':
        shouldReset = this.matchesHeaderFlag(req, policy);
        break;
      case 'aggressive':
        shouldReset = true;
        break;
      default:
        shouldReset = false;
    }

    if (!shouldReset) {
      return false;
    }

    if (policy.cooldownMs > 0) {
      this.cooldownUntil = now + policy.cooldownMs;
    }

    return true;
  }

  private matchesAllowlist(
    req: HttpRequest<unknown>,
    policy: SessionTimeoutConfig['httpActivity']
  ): boolean {
    if (policy.allowlist.length === 0) {
      return false;
    }

    const url = req.urlWithParams;
    return policy.allowlist.some(pattern => this.matches(pattern, url));
  }

  private matchesHeaderFlag(
    req: HttpRequest<unknown>,
    policy: SessionTimeoutConfig['httpActivity']
  ): boolean {
    const headerName = policy.headerFlag ?? 'X-Session-Activity';
    const headerValue = req.headers.get(headerName);
    if (this.isTruthy(headerValue)) {
      return true;
    }

    if (policy.contextToken) {
      return this.resolveContextFlag(req, policy.contextToken);
    }

    return false;
  }

  private resolveContextFlag(req: HttpRequest<unknown>, tokenName: string): boolean {
    const context = req.context as HttpContext | undefined;
    if (!context) {
      return false;
    }
    const token = getSessionActivityContextToken(tokenName);
    return context.get(token) === true;
  }

  private isDocumentFocused(): boolean {
    if (!this.document) {
      return true;
    }
    if (typeof this.document.hasFocus === 'function') {
      return this.document.hasFocus();
    }
    return this.document.visibilityState !== 'hidden';
  }

  private matches(pattern: RegExp, value: string): boolean {
    if (pattern.global || pattern.sticky) {
      pattern.lastIndex = 0;
    }
    return pattern.test(value);
  }

  private isTruthy(value: string | null): boolean {
    if (value == null) {
      return false;
    }
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    return !['false', '0', 'off', 'no'].includes(normalized);
  }
}
