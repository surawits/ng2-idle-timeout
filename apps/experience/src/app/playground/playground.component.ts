import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SessionTimeoutService } from 'ng2-idle-timeout';

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

  idleGraceSeconds = 60;
  countdownSeconds = 300;
  warnBeforeSeconds = 60;
  autoResume = true;

  readonly heroBadges = ['Real-time events', 'Cross-tab ready', 'Server sync'];

  events: EventView[] = [];
  activityLog: ActivityView[] = [];

  readonly eventsPageSize = 5;
  readonly activityPageSize = 5;
  eventPage = 0;
  activityPage = 0;

  private readonly configState = signal(this.sessionTimeout.getConfig());
  private readonly renderNow = signal(Date.now());
  private renderTimerHandle: ReturnType<typeof setInterval> | null = null;

  readonly snapshot = computed(() => this.sessionTimeout.getSnapshot());
  readonly sessionState = computed(() => this.snapshot().state);
  readonly sessionBadgeClass = computed(() => {
    const state = this.sessionState();
    if (state === 'EXPIRED') {
      return 'text-bg-danger';
    }
    if (state === 'WARN') {
      return 'text-bg-warning text-dark';
    }
    return 'text-bg-success';
  });
  readonly isWarnState = computed(() => this.sessionState() === 'WARN');

  readonly idleRemainingSeconds = computed(() => {
    const snapshot = this.snapshot();
    const config = this.configState();
    if (snapshot.state !== 'IDLE' || snapshot.idleStartAt == null) {
      return 0;
    }
    const remainingMs = Math.max(0, snapshot.idleStartAt + config.idleGraceMs - this.renderNow());
    return remainingMs / 1000;
  });

  readonly countdownRemainingSeconds = computed(() => {
    const snapshot = this.snapshot();
    const config = this.configState();
    const target = snapshot.countdownEndAt;
    if (target == null) {
      return snapshot.state === 'IDLE' ? config.countdownMs / 1000 : 0;
    }
    const remainingMs = Math.max(0, target - this.renderNow());
    return remainingMs / 1000;
  });

  readonly warningWindowSeconds = computed(() => this.configState().warnBeforeMs / 1000);

  readonly countdownTargetDate = computed(() => {
    const target = this.snapshot().countdownEndAt;
    return target ? new Date(target) : null;
  });

  constructor() {
    this.sessionTimeout.start();
    this.applyConfig();
    this.startRenderTicker();

    const eventsSub = this.sessionTimeout.events$.subscribe(event => {
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
      const view = this.formatActivity(activity);
      this.activityLog = [view, ...this.activityLog].slice(0, 50);
      this.activityPage = 0;
    });

    this.destroyRef.onDestroy(() => {
      eventsSub.unsubscribe();
      activitySub.unsubscribe();
      this.stopRenderTicker();
    });
  }

  applyConfig(): void {
    this.sessionTimeout.setConfig({
      idleGraceMs: this.idleGraceSeconds * 1000,
      countdownMs: this.countdownSeconds * 1000,
      warnBeforeMs: this.warnBeforeSeconds * 1000,
      resumeBehavior: this.autoResume ? 'autoOnServerSync' : 'manual'
    });
    this.configState.set(this.sessionTimeout.getConfig());
  }

  pause(): void {
    this.sessionTimeout.pause();
  }

  resume(): void {
    this.sessionTimeout.resume();
  }

  extend(): void {
    this.sessionTimeout.extend({ source: 'playground' });
  }

  resetIdle(source: 'dom' | 'http' | 'manual'): void {
    this.sessionTimeout.resetIdle({ source }, { source });
  }

  triggerServerSync(): void {
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

  private startRenderTicker(): void {
    if (this.renderTimerHandle != null) {
      return;
    }
    this.renderTimerHandle = window.setInterval(() => {
      this.renderNow.set(Date.now());
    }, 250);
  }

  private stopRenderTicker(): void {
    if (this.renderTimerHandle != null) {
      clearInterval(this.renderTimerHandle);
      this.renderTimerHandle = null;
    }
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
