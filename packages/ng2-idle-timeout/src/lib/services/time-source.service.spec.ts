import { EnvironmentInjector } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import type { Observable } from 'rxjs';

import { TimeSourceService } from './time-source.service';

describe('TimeSourceService', () => {
  let service: TimeSourceService;
  let injector: EnvironmentInjector;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [TimeSourceService]
    });

    service = TestBed.inject(TimeSourceService);
    injector = TestBed.inject(EnvironmentInjector);
  });

  it('keeps offset signal and observable in parity', fakeAsync(() => {
    const offset$: Observable<number> = service.offset$;
    const offsetFrom$ = injector.runInContext(() =>
      toSignal(offset$, { initialValue: service.offset() })
    );

    expect(service.offset()).toBe(0);
    expect(offsetFrom$()).toBe(0);

    service.setOffset(500);
    flushMicrotasks();
    expect(service.offset()).toBe(500);
    expect(offsetFrom$()).toBe(500);

    service.resetOffset();
    flushMicrotasks();
    expect(service.offset()).toBe(0);
    expect(offsetFrom$()).toBe(0);
  }));
});
