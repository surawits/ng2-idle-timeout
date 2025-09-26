export interface BroadcastAdapter {
  publish(message: unknown): void;
  close(): void;
  subscribe(callback: (message: MessageEvent) => void): void;
}

export function createBroadcastChannel(name: string): BroadcastAdapter | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }
  try {
    const channel = new BroadcastChannel(name);
    return {
      publish: message => channel.postMessage(message),
      close: () => channel.close(),
      subscribe: callback => {
        channel.addEventListener('message', callback);
      }
    };
  } catch (error) {
    console.warn('[ng2-idle-timeout] BroadcastChannel unavailable', error);
    return null;
  }
}
