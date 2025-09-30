import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  SessionTimeoutService,
  DOM_ACTIVITY_EVENT_NAMES,
  DEFAULT_SESSION_TIMEOUT_CONFIG,
  type DomActivityEventName
} from 'ng2-idle-timeout';

interface EventView {
  type: string;
  state: string;
  at: number;
  timeLabel: string;
  remainingSeconds: number;
  metaSummary?: string;
}

interface ActivityView {
  at: number;
  source: string;
  summary: string;
  detail?: string;
}

@Component({
  selector: 'experience-playground',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, DatePipe],
  templateUrl: './playground.component.html',
  styleUrl: './playground.component.scss'
})
export class PlaygroundComponent {
  private readonly sessionTimeout = inject(SessionTimeoutService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly initialConfig = this.sessionTimeout.getConfig();

  readonly domEventOptions = DOM_ACTIVITY_EVENT_NAMES;
  readonly defaultDomEventSelection = new Set<DomActivityEventName>(
    DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents
  );
  domEventSelection = new Set<DomActivityEventName>(this.initialConfig.domActivityEvents);

  idleGraceSeconds = 60;
  countdownSeconds = 300;
  warnBeforeSeconds = 60;
  activityCooldownSeconds = 5;
  autoResume = true;

  readonly heroBadges = ['Real-time events', 'Cross-tab ready', 'Server sync'];

  events: EventView[] = [];
  activityLog: ActivityView[] = [];

  readonly eventsPageSize = 5;
  readonly activityPageSize = 5;
  eventPage = 0;
  activityPage = 0;

  private readonly serviceActive = signal(false);

  private readonly configState = signal(this.initialConfig);

  readonly snapshot = computed(() => this.sessionTimeout.getSnapshot());
  readonly sessionState = computed(() => this.snapshot().state);
  readonly isSessionActive = computed(() => this.serviceActive());
  readonly isSessionPaused = computed(() => this.serviceActive() && this.snapshot().paused);
  readonly isWarnState = computed(() => this.serviceActive() && this.sessionState() === 'WARN');
  readonly visibleSessionState = computed(() => (this.isSessionActive() ? this.sessionState() : 'Stopped'));

  readonly sessionBadgeClass = computed(() => {
    if (!this.isSessionActive()) {
      return 'text-bg-secondary';
    }
    const state = this.sessionState();
    if (state === 'EXPIRED') {
      return 'text-bg-danger';
    }
    if (state === 'WARN') {
      return 'text-bg-warning text-dark';
    }
    return 'text-bg-success';
  });

  readonly idleRemainingSeconds = computed(() => {
    if (!this.isSessionActive()) {
      return 0;
    }
    return Math.max(0, Math.ceil(this.sessionTimeout.idleRemainingMsSignal() / 1000));
  });

  readonly countdownRemainingSeconds = computed(() => {
    if (!this.isSessionActive()) {
      return 0;
    }
    return Math.max(0, Math.ceil(this.sessionTimeout.countdownRemainingMsSignal() / 1000));
  });

  readonly activityCooldownRemainingSeconds = computed(() => {
    return Math.max(0, Math.ceil(this.sessionTimeout.activityCooldownRemainingMsSignal() / 1000));
  });

  readonly totalRemainingSeconds = computed(() => {
    if (!this.isSessionActive()) {
      return 0;
    }
    return Math.max(0, Math.ceil(this.sessionTimeout.totalRemainingMsSignal() / 1000));
  });

  readonly warningModalCountdownSeconds = computed(() => {
    if (!this.isSessionActive()) {
      return 0;
    }
    const state = this.sessionTimeout.stateSignal();
    if (state === 'WARN' || state === 'EXPIRED' || state === 'IDLE') {
      return 0;
    }
    if (state === 'COUNTDOWN') {
      const remainingMs = this.sessionTimeout.countdownRemainingMsSignal();
      const warnBeforeMs = this.configState().warnBeforeMs;
      if (remainingMs <= warnBeforeMs) {
        return 0;
      }
      return Math.ceil((remainingMs - warnBeforeMs) / 1000);
    }
    return 0;
  });

  readonly warningModalTargetDate = computed(() => {
    if (!this.isSessionActive()) {
      return null;
    }
    const countdownEndAt = this.snapshot().countdownEndAt;
    if (countdownEndAt == null) {
      return null;
    }
    return new Date(countdownEndAt - this.configState().warnBeforeMs);
  });

  readonly countdownTargetDate = computed(() => {
    if (!this.isSessionActive()) {
      return null;
    }
    const target = this.snapshot().countdownEndAt;
    return target ? new Date(target) : null;
  });

  constructor() {
    this.applyConfig();
    this.sessionTimeout.stop();

    const eventsSub = this.sessionTimeout.events$.subscribe(event => {
      if (!this.serviceActive()) {
        if (event.type !== 'Stopped') {
          this.sessionTimeout.stop();
        }
        return;
      }
      const metaSummary = this.summariseMeta(event.meta);
      const view: EventView = {
        type: event.type,
        state: event.state,
        at: event.at,
        timeLabel: new Date(event.at).toLocaleTimeString(),
        remainingSeconds: Math.max(0, Math.floor((event.snapshot?.remainingMs ?? 0) / 1000)),
        metaSummary
      };
      this.events = [view, ...this.events].slice(0, 50);
      this.eventPage = 0;
    });

    const activitySub = this.sessionTimeout.activity$.subscribe(activity => {
      if (!this.serviceActive()) {
        return;
      }
      const view = this.formatActivity(activity);
      this.activityLog = [view, ...this.activityLog].slice(0, 50);
      this.activityPage = 0;
    });

    this.destroyRef.onDestroy(() => {
      eventsSub.unsubscribe();
      activitySub.unsubscribe();
    });
  }

  applyConfig(): void {
    const domActivityEvents = this.currentDomActivityEvents();
    this.sessionTimeout.setConfig({
      idleGraceMs: this.idleGraceSeconds * 1000,
      countdownMs: this.countdownSeconds * 1000,
      warnBeforeMs: this.warnBeforeSeconds * 1000,
      activityResetCooldownMs: this.activityCooldownSeconds * 1000,
      resumeBehavior: this.autoResume ? 'autoOnServerSync' : 'manual',
      domActivityEvents
    });
    const nextConfig = this.sessionTimeout.getConfig();
    this.configState.set(nextConfig);
    this.domEventSelection = new Set<DomActivityEventName>(nextConfig.domActivityEvents);
    if (!this.serviceActive()) {
      this.sessionTimeout.stop();
    }
  }

  isDomEventSelected(event: DomActivityEventName): boolean {
    return this.domEventSelection.has(event);
  }

  toggleDomEvent(event: DomActivityEventName, change: Event): void {
    const target = change.target;
    const enabled = target instanceof HTMLInputElement ? target.checked : false;
    if (enabled) {
      this.domEventSelection.add(event);
    } else {
      this.domEventSelection.delete(event);
    }
    this.applyConfig();
  }

  domEventLabel(event: DomActivityEventName): string {
    switch (event) {
      case 'mousemove':
        return 'Mouse move';
      case 'mousedown':
        return 'Mouse down';
      case 'click':
        return 'Click';
      case 'wheel':
        return 'Wheel';
      case 'scroll':
        return 'Scroll';
      case 'keydown':
        return 'Key down';
      case 'keyup':
        return 'Key up';
      case 'touchstart':
        return 'Touch start';
      case 'touchend':
        return 'Touch end';
      case 'touchmove':
        return 'Touch move';
      case 'visibilitychange':
        return 'Visibility change';
      default:
        return event;
    }
  }

  isDefaultDomEvent(event: DomActivityEventName): boolean {
    return this.defaultDomEventSelection.has(event);
  }

  private currentDomActivityEvents(): DomActivityEventName[] {
    return this.domEventOptions.filter(option => this.domEventSelection.has(option));
  }

  start(): void {
    if (this.serviceActive()) {
      return;
    }
    this.serviceActive.set(true);
    this.events = [];
    this.activityLog = [];
    this.eventPage = 0;
    this.activityPage = 0;
    this.sessionTimeout.start();
  }

  stop(): void {
    if (!this.serviceActive()) {
      return;
    }
    this.serviceActive.set(false);
    this.sessionTimeout.stop();
  }

  pause(): void {
    if (!this.serviceActive() || this.isSessionPaused()) {
      return;
    }
    this.sessionTimeout.pause();
  }

  resume(): void {
    if (!this.serviceActive() || !this.isSessionPaused()) {
      return;
    }
    this.sessionTimeout.resume();
  }

  extend(): void {
    if (!this.serviceActive()) {
      return;
    }
    this.sessionTimeout.extend({ source: 'playground' });
  }

  resetIdle(source: 'dom' | 'http' | 'manual'): void {
    if (!this.serviceActive()) {
      return;
    }
    this.sessionTimeout.resetIdle({ source }, { source });
  }

  triggerServerSync(): void {
    if (!this.serviceActive()) {
      return;
    }
    const handler = (this.sessionTimeout as unknown as { handleServerSync?: () => void }).handleServerSync;
    handler?.call(this.sessionTimeout);
  }

  navigateToDocs(): void {
    void this.router.navigate(['/docs']);
  }

  get eventPageCount(): number {
    return Math.max(1, Math.ceil(this.events.length / this.eventsPageSize) || 1);
  }

  get pagedEvents(): EventView[] {
    const start = this.eventPage * this.eventsPageSize;
    return this.events.slice(start, start + this.eventsPageSize);
  }

  get activityPageCount(): number {
    return Math.max(1, Math.ceil(this.activityLog.length / this.activityPageSize) || 1);
  }

  get pagedActivity(): ActivityView[] {
    const start = this.activityPage * this.activityPageSize;
    return this.activityLog.slice(start, start + this.activityPageSize);
  }

  nextEventPage(): void {
    if (this.events.length === 0) {
      return;
    }
    this.eventPage = Math.min(this.eventPage + 1, this.eventPageCount - 1);
  }

  prevEventPage(): void {
    this.eventPage = Math.max(0, this.eventPage - 1);
  }

  nextActivityPage(): void {
    if (this.activityLog.length === 0) {
      return;
    }
    this.activityPage = Math.min(this.activityPage + 1, this.activityPageCount - 1);
  }

  prevActivityPage(): void {
    this.activityPage = Math.max(0, this.activityPage - 1);
  }

  private summariseMeta(meta: Record<string, unknown> | undefined): string | undefined {
    if (!meta) {
      return undefined;
    }
    const entries = Object.entries(meta)
      .filter(([key, value]) => key !== 'activitySource' && key !== 'type' && value !== undefined && value !== null && value !== '')
      .map(([key, value]) => key + ': ' + String(value));
    return entries.length > 0 ? entries.join(', ') : undefined;
  }

  private formatActivity(activity: { source: string; at: number; meta?: Record<string, unknown> }): ActivityView {
    const meta = activity.meta ?? {};
    const rawType = meta['type'];
    const type = typeof rawType === 'string' ? rawType : activity.source;
    const detailEntries = Object.entries(meta)
      .filter(([key, value]) => key !== 'type' && key !== 'activitySource' && value !== undefined && value !== null && value !== '')
      .map(([key, value]) => key + ': ' + String(value));

    const summary = type === activity.source ? activity.source : activity.source + ' • ' + type;

    return {
      at: activity.at,
      source: activity.source,
      summary,
      detail: detailEntries.length > 0 ? detailEntries.join(', ') : undefined
    };
  }
}
