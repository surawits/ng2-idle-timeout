import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class LeaderElectionService {
  private readonly leaderSignal = signal<boolean>(false);

  readonly isLeader = this.leaderSignal.asReadonly();

  electLeader(): void {
    this.leaderSignal.set(true);
  }

  stepDown(): void {
    this.leaderSignal.set(false);
  }
}
