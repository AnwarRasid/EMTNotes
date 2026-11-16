// Preact access to the progress store. App provides the store through ProgressContext; tests provide a memory store.
import { createContext } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import type { Progress } from './types';
import type { ProgressStore } from './store';

// No default store: a component rendered outside the provider should fail loudly, not save to a hidden store.
export const ProgressContext = createContext<ProgressStore>(null as unknown as ProgressStore);

export function useStore(): ProgressStore {
  const store = useContext(ProgressContext);
  if (!store) throw new Error('useStore() needs a <ProgressContext.Provider> above it.');
  return store;
}

/** The selected slice of progress. Re-renders when the selected value changes (Object.is), not on every update. */
export function useProgress<T>(select: (p: Progress) => T): T {
  const store = useStore();
  const [, rerender] = useState(0);
  const value = select(store.get());
  const latest = useRef({ select, value });
  latest.current = { select, value };

  useEffect(() => {
    const check = (p: Progress) => {
      try {
        if (!Object.is(latest.current.select(p), latest.current.value)) rerender((n) => n + 1);
      } catch {
        // A selector can throw on state its component is about to leave (say quizOpen just became null).
        // Re-render instead: the parent unmounts it, or the render surfaces the error. Never break update().
        rerender((n) => n + 1);
      }
    };
    const unsubscribe = store.subscribe(check);
    check(store.get());   // catch an update between render and subscribe
    return unsubscribe;
  }, [store]);

  return value;
}
