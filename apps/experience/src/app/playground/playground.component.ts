import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  SessionTimeoutService,
  SharedStateCoordinatorService,
  DOM_ACTIVITY_EVENT_NAMES,
  DEFAULT_SESSION_TIMEOUT_CONFIG,
  type DomActivityEventName,
  type SessionTimeoutConfig,
  type SharedSessionState
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

interface MetadataItem {
  label: string;
  value: string;
  hint?: string;
}

const AUTO_START_DELAY_MS = 150;
const STALE_SHARED_STATE_THRESHOLD_MS = 5000;

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
  private readonly route = inject(ActivatedRoute);
  private readonly sharedStateCoordinator = inject(SharedStateCoordinatorService);
  private readonly initialConfig = this.sessionTimeout.getConfig();

  readonly coordinatorSourceId = this.sharedStateCoordinator.getSourceId();

  readonly domEventOptions = DOM_ACTIVITY_EVENT_NAMES;
  readonly defaultDomEventSelection = new Set<DomActivityEventName>(
    DEFAULT_SESSION_TIMEOUT_CONFIG.domActivityEvents
  );
  domEventSelection = new Set<DomActivityEventName>(this.initialConfig.domActivityEvents);

  readonly observerUrl: string;
  readonly isObserverMode: boolean;

  idleGraceSeconds = 60;
  countdownSeconds = 300;
  warnBeforeSeconds = 60;
  activityCooldownSeconds = 5;
  autoResume = true;
  resetOnWarningActivity = this.initialConfig.resetOnWarningActivity;

  readonly heroBadges = ['Real-time events', 'Cross-tab ready', 'Server sync'];

  events: EventView[] = [];
  activityLog: ActivityView[] = [];

  readonly eventsPageSize = 5;
  readonly activityPageSize = 5;
  eventPage = 0;
  activityPage = 0;

  private readonly serviceActive = signal(false);

  private readonly configState = signal(this.initialConfig);

  private readonly sharedStateInternal = signal<SharedSessionState | null>(null);
  readonly sharedState = this.sharedStateInternal.asReadonly();
  private autoStartHandle: ReturnType<typeof setTimeout> | null = null;
  private autoStartSuppressed = false;

  readonly sharedStateUpdatedAt = computed(() => {
    const state = this.sharedState();
    return state ? new Date(state.updatedAt) : null;
  });

  readonly sharedMetadataRows = computed<MetadataItem[]>(() => {
    const state = this.sharedState();
    if (!state) {
      return [];
    }
    return [
      { label: 'Operation', value: this.formatOperation(state.metadata.operation) },
      { label: 'Revision', value: state.metadata.revision.toString() },
      { label: 'Logical clock', value: state.metadata.logicalClock.toString() },
      { label: 'Writer ID', value: state.metadata.writerId },
      { label: 'Causality token', value: state.metadata.causalityToken }
    ];
  });

  readonly sharedConfigRows = computed<MetadataItem[]>(() => {
    const state = this.sharedState();
    if (!state) {
      return [];
    }
    return [
      { label: 'Revision', value: state.config.revision.toString() },
      { label: 'Logical clock', value: state.config.logicalClock.toString() },
      { label: 'Writer ID', value: state.config.writerId }
    ];
  });

  readonly observerConfigRows = computed<MetadataItem[]>(() => {
    const config = this.configState();
    return [
      { label: 'Idle grace', value: Math.round(config.idleGraceMs / 1000) + ' s' },
      { label: 'Countdown', value: Math.round(config.countdownMs / 1000) + ' s' },
      { label: 'Warn before expiry', value: Math.round(config.warnBeforeMs / 1000) + ' s' },
      { label: 'Activity cooldown', value: Math.round(config.activityResetCooldownMs / 1000) + ' s' },
      {
        label: 'Auto resume',
        value: config.resumeBehavior === 'manual' ? 'Disabled' : 'autoOnServerSync'
      },
      {
        label: 'Reset on warning activity',
        value: config.resetOnWarningActivity ? 'Enabled' : 'Disabled'
      },
      {
        label: 'DOM events',
        value:
          config.domActivityEvents.length > 0
            ? config.domActivityEvents.map(event => this.domEventLabel(event)).join(', ')
            : 'None'
      }
    ];
  });

  readonly sharedLeaderInfo = computed(() => {
    const state = this.sharedState();
    if (!state?.leader) {
      return null;
    }
    return {
      id: state.leader.id,
      heartbeatAt: state.leader.heartbeatAt,
      epoch: state.leader.epoch
    };
  });

  private readonly leaderState = this.sessionTimeout.leaderStateSignal;
  private readonly leaderRoleInternal = this.sessionTimeout.leaderRoleSignal;

  readonly leaderRoleLabel = computed(() => {
    const role = this.leaderRoleInternal();
    if (role === 'leader') {
      return 'Leader';
    }
    if (role === 'follower') {
      return 'Follower';
    }
    return 'No leader yet';
  });

  readonly leaderRoleBadgeClass = computed(() => {
    const role = this.leaderRoleInternal();
    if (role === 'leader') {
      return 'text-bg-primary';
    }
    if (role === 'follower') {
      return 'text-bg-info text-dark';
    }
    return 'text-bg-light text-dark';
  });

  readonly canEditConfig = computed(() => this.leaderRoleInternal() !== 'follower');

  readonly leaderDetails = computed(() => {
    const state = this.leaderState();
    if (!state.leaderId) {
      return null;
    }
    return {
      id: state.leaderId,
      epoch: state.leader?.epoch ?? null,
      heartbeatAt: state.leader?.heartbeatAt ?? null
    };
  });

  readonly snapshot = computed(() => this.sessionTimeout.getSnapshot());
  readonly sessionState = computed(() => this.snapshot().state);
  readonly isSessionActive = computed(() => {
    const localSnapshot = this.snapshot();
    if (localSnapshot.idleStartAt != null) {
      return true;
    }
    if (this.serviceActive()) {
      return true;
    }
    const shared = this.sharedState();
    return shared ? shared.snapshot.idleStartAt != null : false;
  });
  readonly isSessionPaused = computed(() => this.isSessionActive() && this.snapshot().paused);
  readonly isWarnState = computed(() => this.isSessionActive() && this.sessionState() === 'WARN');
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
    return Math.max(0, Math.ceil(this.sessionTimeout.idleRemainingMsSignal() / 1000));
  });

  readonly countdownRemainingSeconds = computed(() => {
    return Math.max(0, Math.ceil(this.sessionTimeout.countdownRemainingMsSignal() / 1000));
  });

  readonly activityCooldownRemainingSeconds = computed(() => {
    return Math.max(0, Math.ceil(this.sessionTimeout.activityCooldownRemainingMsSignal() / 1000));
  });

  readonly totalRemainingSeconds = computed(() => {
    return Math.max(0, Math.ceil(this.sessionTimeout.totalRemainingMsSignal() / 1000));
  });

  readonly warningModalCountdownSeconds = computed(() => {
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
    this.isObserverMode = this.route.snapshot.queryParamMap.get('observer') === '1';
    this.observerUrl = this.router.serializeUrl(this.router.createUrlTree([], { queryParams: { observer: '1' } }));

    this.applyConfig();
    this.sessionTimeout.stop();

    const persistedState = this.sharedStateCoordinator.readPersistedState();
    if (persistedState) {
      this.handleSharedStateSnapshot(persistedState);
    } else {
      this.scheduleAutoStart();
    }

    const sharedStateSub = this.sharedStateCoordinator.updates$.subscribe(message => {
      if (message.type === 'state') {
        this.handleSharedStateSnapshot(message.state);
      }
    });

    const eventsSub = this.sessionTimeout.events$.subscribe(event => {
      if (event.type === 'ConfigChanged') {
        this.syncLocalConfigInputs(this.sessionTimeout.getConfig());
      }
      if (event.type === 'Started') {
        this.serviceActive.set(true);
      } else if (event.type === 'Stopped') {
        this.serviceActive.set(false);
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
      sharedStateSub.unsubscribe();
      this.clearAutoStartTimer();
    });
  }

  applyConfig(): void {
    if (this.isObserverMode || !this.canEditConfig()) {
      return;
    }
    const domActivityEvents = this.currentDomActivityEvents();
    this.sessionTimeout.setConfig({
      idleGraceMs: this.idleGraceSeconds * 1000,
      countdownMs: this.countdownSeconds * 1000,
      warnBeforeMs: this.warnBeforeSeconds * 1000,
      activityResetCooldownMs: this.activityCooldownSeconds * 1000,
      resumeBehavior: this.autoResume ? 'autoOnServerSync' : 'manual',
      resetOnWarningActivity: this.resetOnWarningActivity,
      domActivityEvents
    });
    const nextConfig = this.sessionTimeout.getConfig();
    this.syncLocalConfigInputs(nextConfig);
    this.autoStartSuppressed = false;
    this.scheduleAutoStart();
    if (!this.serviceActive()) {
      this.sessionTimeout.stop();
    }
  }

  isDomEventSelected(event: DomActivityEventName): boolean {
    return this.domEventSelection.has(event);
  }

  toggleDomEvent(event: DomActivityEventName, change: Event): void {
    if (this.isObserverMode || !this.canEditConfig()) {
      return;
    }
    const target = change.target;
    const enabled = target instanceof HTMLInputElement ? target.checked : false;
    if (enabled) {
      this.domEventSelection.add(event);
    } else {
      this.domEventSelection.delete(event);
    }
    this.applyConfig();
  }

  requestSharedStateSync(reason?: string): void {
    this.sharedStateCoordinator.requestSync(reason ?? 'playground');
  }

  refreshSharedStateSnapshot(): void {
    const state = this.sharedStateCoordinator.readPersistedState();
    this.sharedStateInternal.set(state);
  }

  clearSharedStateCache(): void {
    this.sharedStateCoordinator.clearPersistedState();
    this.sharedStateInternal.set(null);
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

  private syncLocalConfigInputs(config: SessionTimeoutConfig): void {
    this.configState.set(config);
    this.idleGraceSeconds = Math.round(config.idleGraceMs / 1000);
    this.countdownSeconds = Math.round(config.countdownMs / 1000);
    this.warnBeforeSeconds = Math.round(config.warnBeforeMs / 1000);
    this.activityCooldownSeconds = Math.round(config.activityResetCooldownMs / 1000);
    this.autoResume = config.resumeBehavior !== 'manual';
    this.resetOnWarningActivity = config.resetOnWarningActivity;
    this.domEventSelection = new Set<DomActivityEventName>(config.domActivityEvents);
  }

  private currentDomActivityEvents(): DomActivityEventName[] {
    return this.domEventOptions.filter(option => this.domEventSelection.has(option));
  }

  private handleSharedStateSnapshot(state: SharedSessionState): void {
    this.sharedStateInternal.set(state);
    if (this.isObserverMode) {
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(() => this.syncLocalConfigInputs(this.sessionTimeout.getConfig()));
      } else {
        setTimeout(() => this.syncLocalConfigInputs(this.sessionTimeout.getConfig()), 0);
      }
      return;
    }
    const localSnapshot = this.snapshot();
    if (localSnapshot.idleStartAt != null) {
      return;
    }
    const remoteActive =
      state.snapshot.idleStartAt != null &&
      state.metadata.writerId !== this.coordinatorSourceId &&
      Date.now() - state.updatedAt < STALE_SHARED_STATE_THRESHOLD_MS;
    if (remoteActive) {
      this.clearAutoStartTimer();
      return;
    }
    this.scheduleAutoStart();
  }

  private scheduleAutoStart(): void {
    if (this.isObserverMode) {
      return;
    }
    if (this.autoStartSuppressed) {
      return;
    }
    const localSnapshot = this.snapshot();
    if (localSnapshot.idleStartAt != null) {
      return;
    }
    const shared = this.sharedState();
    if (
      shared &&
      shared.snapshot.idleStartAt != null &&
      shared.metadata.writerId !== this.coordinatorSourceId &&
      Date.now() - shared.updatedAt < STALE_SHARED_STATE_THRESHOLD_MS
    ) {
      return;
    }
    this.clearAutoStartTimer();
    this.autoStartHandle = setTimeout(() => {
      this.autoStartHandle = null;
      const latestSnapshot = this.snapshot();
      if (latestSnapshot.idleStartAt != null) {
        return;
      }
      if (this.autoStartSuppressed) {
        return;
      }
      const latestShared = this.sharedState();
      if (
        latestShared &&
        latestShared.snapshot.idleStartAt != null &&
        latestShared.metadata.writerId !== this.coordinatorSourceId &&
        Date.now() - latestShared.updatedAt < STALE_SHARED_STATE_THRESHOLD_MS
      ) {
        return;
      }
      this.start();
    }, AUTO_START_DELAY_MS);
  }

  private clearAutoStartTimer(): void {
    if (this.autoStartHandle != null) {
      clearTimeout(this.autoStartHandle);
      this.autoStartHandle = null;
    }
  }

  start(): void {
    if (this.isObserverMode) {
      return;
    }
    if (this.serviceActive()) {
      return;
    }
    this.autoStartSuppressed = false;
    this.clearAutoStartTimer();
    this.serviceActive.set(true);
    this.events = [];
    this.activityLog = [];
    this.eventPage = 0;
    this.activityPage = 0;
    this.sessionTimeout.start();
  }

  stop(): void {
    if (this.isObserverMode) {
      return;
    }
    if (!this.serviceActive()) {
      return;
    }
    this.serviceActive.set(false);
    this.autoStartSuppressed = true;
    this.clearAutoStartTimer();
    this.sessionTimeout.stop();
  }

  pause(): void {
    if (this.isObserverMode) {
      return;
    }
    if (!this.serviceActive() || this.isSessionPaused()) {
      return;
    }
    this.sessionTimeout.pause();
  }

  resume(): void {
    if (this.isObserverMode) {
      return;
    }
    if (!this.serviceActive() || !this.isSessionPaused()) {
      return;
    }
    this.sessionTimeout.resume();
  }

  extend(): void {
    if (this.isObserverMode) {
      return;
    }
    if (!this.serviceActive()) {
      return;
    }
    this.sessionTimeout.extend({ source: 'playground' });
  }

  staySignedIn(): void {
    if (this.isObserverMode) {
      return;
    }
    this.resetIdle('manual');
  }

  expireSession(): void {
    if (this.isObserverMode) {
      return;
    }
    if (!this.serviceActive()) {
      return;
    }
    this.sessionTimeout.expireNow({ source: 'playgroundModal' });
  }

  resetIdle(source: 'dom' | 'http' | 'manual'): void {
    if (this.isObserverMode) {
      return;
    }
    if (!this.serviceActive()) {
      return;
    }
    this.sessionTimeout.resetIdle({ source }, { source });
  }

  triggerServerSync(): void {
    if (this.isObserverMode) {
      return;
    }
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
      .filter(
        ([key, value]) =>
          key !== 'activitySource' &&
          key !== 'type' &&
          key !== 'resetSuppressed' &&
          key !== 'resetSuppressedReason' &&
          value !== undefined &&
          value !== null &&
          value !== ''
      )
      .map(([key, value]) => key + ': ' + String(value));
    return entries.length > 0 ? entries.join(', ') : undefined;
  }

  private formatActivity(activity: { source: string; at: number; meta?: Record<string, unknown> }): ActivityView {
    const meta = activity.meta ?? {};
    const rawType = meta['type'];
    const type = typeof rawType === 'string' ? rawType : activity.source;
    const detailEntries = Object.entries(meta)
      .filter(
        ([key, value]) =>
          key !== 'type' &&
          key !== 'activitySource' &&
          key !== 'resetSuppressed' &&
          key !== 'resetSuppressedReason' &&
          value !== undefined &&
          value !== null &&
          value !== ''
      )
      .map(([key, value]) => key + ': ' + String(value));

    let summary = type === activity.source ? activity.source : activity.source + ' -> ' + type;
    if (meta['resetSuppressed'] === true) {
      const reason =
        typeof meta['resetSuppressedReason'] === 'string' ? meta['resetSuppressedReason'] : 'suppressed';
      summary += ' (suppressed: ' + reason + ')';
    }

    return {
      at: activity.at,
      source: activity.source,
      summary,
      detail: detailEntries.length > 0 ? detailEntries.join(', ') : undefined
    };
  }

  private formatOperation(operation: SharedSessionState['metadata']['operation']): string {
    return operation
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
}


