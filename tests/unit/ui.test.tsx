import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import { Primary, Secondary, TextLink } from '../../src/ui/Keys';
import { Panel } from '../../src/ui/Panel';
import { Skeleton } from '../../src/ui/Skeleton';
import { hasVisibleFocus } from '../../src/lib/focus';

describe('Primary and Secondary', () => {
  it('render a link when given an href, and pass the click on', () => {
    const onClick = vi.fn();
    render(<Primary href="#/quiz/setup" onClick={onClick}>Start practice</Primary>);
    const link = screen.getByRole('link', { name: 'Start practice' });
    expect(link.getAttribute('href')).toBe('#/quiz/setup');
    expect(link.className).toBe('primary');
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('render a plain button without an href', () => {
    const onClick = vi.fn();
    render(<Secondary onClick={onClick}>Done</Secondary>);
    const button = screen.getByRole('button', { name: 'Done' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toBe('btn2');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('render a disabled button, never a link, when disabled', () => {
    render(<Primary href="#/quiz/session" disabled>Check</Primary>);
    expect(screen.queryByRole('link')).toBeNull();
    expect((screen.getByRole('button', { name: 'Check' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('TextLink', () => {
  it('is an underlined link with its href', () => {
    render(<TextLink href="#/notes/s11">Notes 11, Oxygen masks</TextLink>);
    const link = screen.getByRole('link', { name: 'Notes 11, Oxygen masks' });
    expect(link.getAttribute('href')).toBe('#/notes/s11');
    expect(link.className).toBe('link');
  });
});

describe('Panel', () => {
  it('is a section with the panel class by default', () => {
    const { container } = render(<Panel>Last run</Panel>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('SECTION');
    expect(el.className).toBe('panel');
  });

  it('takes another element and adds its classes after panel', () => {
    const { container } = render(<Panel as="aside" class="last">Last run</Panel>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.tagName).toBe('ASIDE');
    expect(el.className).toBe('panel last');
  });
});

describe('Skeleton', () => {
  it('draws its rows at least rowHeight tall, as one labelled loading indicator', () => {
    render(<Skeleton rows={3} rowHeight="3.375rem" />);
    const bar = screen.getByRole('progressbar', { name: 'Loading' });
    const rows = [...bar.querySelectorAll<HTMLElement>('.sk-row')];
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.style.minHeight).toBe('3.375rem');
      expect(row.style.height).toBe('');
    }
  });

  it('takes a height per row from a list, the last one repeating', () => {
    render(<Skeleton rows={4} rowHeight={['5rem', '9rem']} />);
    const rows = [...screen.getByRole('progressbar').querySelectorAll<HTMLElement>('.sk-row')];
    expect(rows.map((r) => r.style.minHeight)).toEqual(['5rem', '9rem', '9rem', '9rem']);
  });
});

describe('hasVisibleFocus', () => {
  const key = (matches: (s: string) => boolean) => Object.assign(document.createElement('button'), { matches });

  it('is false for no target, or one that is not an element', () => {
    expect(hasVisibleFocus(null)).toBe(false);
    expect(hasVisibleFocus(window)).toBe(false);
  });

  it('follows :focus-visible: a ring for a keyboard user, none for focus a script moved after a tap', () => {
    expect(hasVisibleFocus(key((s) => s === ':focus-visible'))).toBe(true);
    expect(hasVisibleFocus(key(() => false))).toBe(false);
  });

  it('counts any focus where the browser has no :focus-visible', () => {
    expect(hasVisibleFocus(key(() => { throw new SyntaxError("':focus-visible' is not a valid selector"); }))).toBe(true);
  });
});
