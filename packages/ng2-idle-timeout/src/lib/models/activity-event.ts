export type ActivitySource = 'dom' | 'router' | 'http' | 'manual' | 'cross-tab';

export interface ActivityEvent {
  source: ActivitySource;
  at: number;
  meta?: Record<string, unknown>;
}
