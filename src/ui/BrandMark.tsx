// The brand: a Star of Life drawn from scratch (mockup line 299, unchanged) over a strip of the band, then the name.
// No SCDF logo, crest or wordmark.
import type { JSX } from 'preact';

export function BrandMark(): JSX.Element {
  return (
    <div class="brand">
      <span class="mark" aria-hidden="true">
        <svg viewBox="-50 -50 100 100">
          <g class="sol-rim">
            <rect x="-16" y="-50" width="32" height="100" rx="2" />
            <rect x="-16" y="-50" width="32" height="100" rx="2" transform="rotate(60)" />
            <rect x="-16" y="-50" width="32" height="100" rx="2" transform="rotate(120)" />
          </g>
          <g class="sol-star">
            <rect x="-11.5" y="-45.5" width="23" height="91" />
            <rect x="-11.5" y="-45.5" width="23" height="91" transform="rotate(60)" />
            <rect x="-11.5" y="-45.5" width="23" height="91" transform="rotate(120)" />
          </g>
          <path class="sol-rod" stroke-width="5.5" d="M0 -32V36" />
          <path class="sol-rod" stroke-width="4.5" d="M-2 30C11 25 11 16 0 12C-11 8 -11 -1 0 -5C11 -9 11 -18 3 -23" />
          <circle class="sol-head" cx="4" cy="-25" r="4.5" />
        </svg>
        <i class="bb" />
      </span>
      EMTNotes
    </div>
  );
}
