// The app's one progress store over localStorage. Importing this module reads window, so code that must run
// without a DOM (the Playwright seed helper) imports types.ts and slots.ts directly instead.
import { createProgressStore, persistOnce, safeLocalStorage, type ProgressStore } from './store';

export * from './types';
export * from './slots';
export * from './store';
export * from './hooks';

export const progress: ProgressStore = createProgressStore(safeLocalStorage());
void persistOnce();   // the answer is kept for Settings
