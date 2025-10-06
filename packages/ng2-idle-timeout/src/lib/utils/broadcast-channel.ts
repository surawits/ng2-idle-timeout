export interface BroadcastAdapter {
  publish(message: unknown): void;
  close(): void;
  subscribe(callback: (message: MessageEvent) => void): void;
}

function createNativeChannel(name: string): BroadcastAdapter | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
    return null;
  }

  try {
    const channel = new BroadcastChannel(name);
    const listeners = new Set<(message: MessageEvent) => void>();

    const handleMessage = (event: MessageEvent) => {
      listeners.forEach(listener => listener(event));
    };

    channel.addEventListener('message', handleMessage);

    return {
      publish: message => channel.postMessage(message),
      close: () => {
        channel.removeEventListener('message', handleMessage);
        channel.close();
        listeners.clear();
      },
      subscribe: callback => {
        listeners.add(callback);
      }
    };
  } catch (error) {
    console.warn('[ng2-idle-timeout] BroadcastChannel unavailable', error);
    return null;
  }
}

function createLocalStorageChannel(name: string): BroadcastAdapter | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const storage = window.localStorage;
    const listeners = new Set<(message: MessageEvent) => void>();
    const storageKey = `__ng2_idle_timeout_bc__${name}`;

    const toMessageEvent = (data: unknown): MessageEvent => {
      if (typeof MessageEvent === 'function') {
        return new MessageEvent('message', { data });
      }
      return {
        data,
        origin: window.location?.origin ?? '',
        lastEventId: '',
        ports: [],
        source: null,
        type: 'message',
        bubbles: false,
        cancelBubble: false,
        cancelable: false,
        composed: false,
        currentTarget: null,
        defaultPrevented: false,
        eventPhase: 0,
        isTrusted: false,
        returnValue: true,
        srcElement: null,
        target: null,
        timeStamp: Date.now(),
        scoped: false,
        composedPath: () => [],
        initEvent: () => undefined,
        preventDefault: () => undefined,
        stopImmediatePropagation: () => undefined,
        stopPropagation: () => undefined
      } as unknown as MessageEvent;
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== storageKey || event.newValue == null) {
        return;
      }
      try {
        const parsed = JSON.parse(event.newValue);
        listeners.forEach(listener => listener(toMessageEvent(parsed?.message)));
      } catch (error) {
        console.warn('[ng2-idle-timeout] Invalid broadcast payload from storage', error);
      }
    };

    window.addEventListener('storage', handleStorage);

    return {
      publish: message => {
        const payload = JSON.stringify({ message, timestamp: Date.now() });
        storage.setItem(storageKey, payload);
        storage.removeItem(storageKey);
      },
      close: () => {
        window.removeEventListener('storage', handleStorage);
        listeners.clear();
      },
      subscribe: callback => {
        listeners.add(callback);
      }
    };
  } catch (error) {
    console.warn('[ng2-idle-timeout] Unable to create localStorage broadcast fallback', error);
    return null;
  }
}

export function createBroadcastChannel(name: string): BroadcastAdapter | null {
  const nativeChannel = createNativeChannel(name);
  if (nativeChannel) {
    return nativeChannel;
  }
  return createLocalStorageChannel(name);
}
