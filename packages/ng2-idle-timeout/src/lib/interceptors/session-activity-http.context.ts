import { HttpContextToken } from '@angular/common/http';

const tokenRegistry = new Map<string, HttpContextToken<boolean>>();

/**
 * Retrieve (or lazily create) a shared HttpContextToken used to flag a request
 * as session activity.
 */
export function getSessionActivityContextToken(name: string): HttpContextToken<boolean> {
  let token = tokenRegistry.get(name);
  if (!token) {
    token = new HttpContextToken<boolean>(() => false);
    tokenRegistry.set(name, token);
  }
  return token;
}
