// The one header layout every focus screen shares (spec §6.1): an exit button, the title over a sub-line,
// and a timer or counter on the right. Exits are Pause for a run and ✕ (Close) elsewhere.
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from '../ui/Icon';

export function FocusHeader({ exit, onExit, title, sub, right }:
  { exit: 'close' | 'pause'; onExit(): void; title: string; sub?: string; right?: ComponentChildren }): JSX.Element {
  return (
    <header class="mhead">
      <button type="button" class="ibtn" aria-label={exit === 'close' ? 'Close' : 'Pause'} onClick={() => onExit()}>
        <Icon name={exit} />
      </button>
      <div class="mhead-text">
        <h1 class="title">{title}</h1>
        {sub && <p class="addr">{sub}</p>}
      </div>
      {right}
    </header>
  );
}
