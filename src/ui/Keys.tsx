// Action keys and links. Primary is the one key that acts on a screen: ambulance white with the band along its
// lower edge. Secondary is the outlined key beside it. With an href a key is a link, otherwise a button; a
// disabled key is always a button, since a link can't be disabled.
import type { ComponentChildren, JSX } from 'preact';

/** `describedBy` names the ids of text that explains the key, say why it is disabled. */
export interface KeyProps { href?: string; onClick?(): void; disabled?: boolean; describedBy?: string; children: ComponentChildren }

function key(cls: string, { href, onClick, disabled, describedBy, children }: KeyProps): JSX.Element {
  const click = onClick ? () => onClick() : undefined;
  if (href !== undefined && !disabled) {
    return <a class={cls} href={href} aria-describedby={describedBy} onClick={click}>{children}</a>;
  }
  return <button type="button" class={cls} disabled={disabled} aria-describedby={describedBy} onClick={click}>{children}</button>;
}

export function Primary(p: KeyProps): JSX.Element {
  return key('primary', p);
}

export function Secondary(p: KeyProps): JSX.Element {
  return key('btn2', p);
}

/** An underlined text link with a 44px target. */
export function TextLink({ href, children }: { href: string; children: ComponentChildren }): JSX.Element {
  return <a class="link" href={href}>{children}</a>;
}
