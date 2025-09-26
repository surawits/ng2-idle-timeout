import { Injectable, computed, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { now } from '../utils/platform';

@Injectable({ providedIn: 'root' })
export class TimeSourceService {
  private readonly offsetSignal = signal(0);

  readonly offset: Signal<number> = computed(() => this.offsetSignal());

  now(): number {
    return now() + this.offsetSignal();
  }

  setOffset(ms: number): void {
    this.offsetSignal.set(ms);
  }

  resetOffset(): void {
    this.offsetSignal.set(0);
  }
}
