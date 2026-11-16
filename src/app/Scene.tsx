// The patient cabin at night behind every screen: overhead lockers, a dimmed LED strip, and light from outside
// that changes by screen (street-lamp amber on Today, red and blue beacons on a run, quiet elsewhere).
import type { JSX } from 'preact';
import type { SceneVariant } from './routes';

export function Scene({ variant }: { variant: SceneVariant }): JSX.Element {
  return <div class={variant === 'today' ? 'scene' : `scene scene-${variant}`} aria-hidden="true" />;
}
