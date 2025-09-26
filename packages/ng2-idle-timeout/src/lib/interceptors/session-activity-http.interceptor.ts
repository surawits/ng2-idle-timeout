import { Injectable } from '@angular/core';
import type { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import type { Observable } from 'rxjs';

@Injectable()
export class SessionActivityHttpInterceptor implements HttpInterceptor {
  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    return next.handle(req);
  }
}
