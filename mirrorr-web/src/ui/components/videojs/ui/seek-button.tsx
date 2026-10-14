'use client';

import '../styles/base.css';
import '../styles/audio/theme.css';
import '../styles/video/captions.css';
import '../styles/video/theme.css';
import '../styles/buttons.css';
import { SeekButton as SeekButtonPrimitive } from '@videojs/react';

import { Button } from '@/ui/components/videojs/ui/button';
import { cn, resolveClassName } from '@/ui/lib/resolve-class-name';

export type SeekButtonProps = Omit<SeekButtonPrimitive.Props, 'children' | 'seconds'> & {
  readonly seconds?: number;
};

const BACKWARD_RING =
  'M9 1a7.98 7.98 0 0 0-6.132 2.867l-1.441-1.44A.25.25 0 0 0 1 2.604V6.75c0 .138.112.25.25.25h4.146a.25.25 0 0 0 .177-.427L4.29 5.29A5.99 5.99 0 0 1 9 3a6 6 0 1 1-6 6H1a8 8 0 1 0 8-8';
const FORWARD_RING =
  'M9 1a7.98 7.98 0 0 1 6.132 2.867l1.441-1.44a.25.25 0 0 1 .427.177V6.75a.25.25 0 0 1-.25.25h-4.146a.25.25 0 0 1-.177-.427L13.71 5.29A5.99 5.99 0 0 0 9 3a6 6 0 0 0-4.242 10.242l-1.415 1.415A8 8 0 0 1 9 1';

/** Step button with the seconds baked into the ring, one glyph like its siblings. */
export function SeekButton({ className, seconds = -10, ...props }: SeekButtonProps = {}) {
  const step = Math.abs(seconds);
  return (
    <SeekButtonPrimitive
      seconds={seconds}
      render={<Button />}
      className={(state) => cn('media-seek-button', resolveClassName(className, state))}
      {...props}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="currentColor"
        aria-hidden="true"
        className={cn('media-button-icon')}
      >
        <path d={seconds < 0 ? BACKWARD_RING : FORWARD_RING} />
        <text
          x={seconds < 0 ? 8.8 : 9.2}
          y="8.72"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="7.5"
          fontWeight="800"
          fill="currentColor"
        >
          {step}
        </text>
      </svg>
    </SeekButtonPrimitive>
  );
}
