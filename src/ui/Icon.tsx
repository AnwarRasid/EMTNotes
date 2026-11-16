// Line icons, 24-unit grid, stroked in currentColor. Paths come from the approved mockup; search and the two
// chevrons are the same stroke family. Always decorative: the button or link around an icon carries the name.
import type { JSX } from 'preact';

export type IconName = 'today' | 'pam' | 'quiz' | 'notes' | 'settings' | 'close' | 'pause' | 'check' | 'cross' | 'list' | 'search'
  | 'back' | 'forward' | 'send' | 'mic';

// Functions, not shared vnodes: Preact must not mount one vnode object in two places.
const SHAPES: Record<IconName, () => JSX.Element> = {
  today: () => <><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></>,
  pam: () => <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  quiz: () => <><circle cx="12" cy="12" r="10" /><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01" /></>,
  notes: () => <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M16 13H8M16 17H8" /></>,
  settings: () => <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>,
  close: () => <path d="M18 6 6 18M6 6l12 12" />,
  pause: () => <path d="M9 5v14M15 5v14" />,
  check: () => <path d="M20 6 9 17l-5-5" />,
  cross: () => <path d="M18 6 6 18M6 6l12 12" />,
  list: () => <path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />,
  search: () => <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
  back: () => <path d="m15 18-6-6 6-6" />,
  forward: () => <path d="m9 18 6-6-6-6" />,
  send: () => <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  mic: () => <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" /></>,
};

export function Icon({ name }: { name: IconName }): JSX.Element {
  const Shape = SHAPES[name];
  return <svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><Shape /></svg>;
}
