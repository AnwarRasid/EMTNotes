// A smoked, rim-lit panel over the cabin scene.
import type { ComponentChildren, JSX } from 'preact';

export function Panel({ as: Tag = 'section', class: cls, children }:
  { as?: 'section' | 'div' | 'aside'; class?: string; children: ComponentChildren }): JSX.Element {
  return <Tag class={cls ? `panel ${cls}` : 'panel'}>{children}</Tag>;
}
