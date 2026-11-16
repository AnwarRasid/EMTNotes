// The four tabs. Focus screens hide it.
import type { JSX } from 'preact';
import { Icon } from '../ui/Icon';
import type { TabId } from './routes';

const TABS: { id: TabId; label: string; href: string }[] = [
  { id: 'today', label: 'Today', href: '#/' },
  { id: 'pam', label: 'PAM', href: '#/pam' },
  { id: 'quiz', label: 'Quiz', href: '#/quiz' },
  { id: 'notes', label: 'Notes', href: '#/notes' },
];

export function TabBar({ active }: { active: TabId | null }): JSX.Element {
  return (
    <nav class="tabs" aria-label="Main">
      {TABS.map((t) => (
        <a key={t.id} class={t.id === active ? 'tab on' : 'tab'} href={t.href} aria-current={t.id === active ? 'page' : undefined}>
          <Icon name={t.id} />{t.label}
        </a>
      ))}
    </nav>
  );
}
