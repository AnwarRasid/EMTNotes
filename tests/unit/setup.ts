// Runs before every unit test file (vite.config.ts test.setupFiles). jsdom has no service worker, so the PWA
// register hook is mocked here with inert defaults: nothing to refresh, not offline-ready, an update that does
// nothing. Every test that renders <App/> gets these; tests/unit/pwa.test.tsx mocks it again with controls.
import { beforeEach, vi } from 'vitest';

// The composer keeps each run's draft in sessionStorage (Plan 3 Task 7), which jsdom keeps for the whole file. The
// tests reuse run ids, so each starts with none. The smart tester's settings (Plan 3 Task 9) sit in localStorage apart
// from progress, so each test starts with none of them either. A file in the node environment (the Claude transport's,
// D20) has no window and no storage.
beforeEach(() => {
  if (typeof window === 'undefined') return;
  sessionStorage.clear();
  localStorage.removeItem('crewleader.smart');
});

vi.mock('virtual:pwa-register/preact', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, () => {}],
    offlineReady: [false, () => {}],
    updateServiceWorker: async () => {},
  }),
}));
