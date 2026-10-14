import type { ComponentProps } from 'react';

import { SeekIndicator } from '@/ui/components/videojs/ui/seek-indicator';
import { StatusAnnouncer } from '@/ui/components/videojs/ui/status-announcer';
import { PlaybackStatusIndicator, StatusIndicator } from '@/ui/components/videojs/ui/status-indicator';
import { VolumeIndicator } from '@/ui/components/videojs/ui/volume-indicator';
import { cn } from '@/ui/lib/resolve-class-name';

export type VideoStatusIndicatorsProps = Omit<ComponentProps<'div'>, 'children'>;

export function VideoStatusIndicators({ className, ...props }: VideoStatusIndicatorsProps = {}) {
  return (
    <>
      <StatusAnnouncer />
      <div className={cn('video-status-indicators', className)} {...props}>
        <VolumeIndicator />
        <StatusIndicator />
        <SeekIndicator />
        <PlaybackStatusIndicator />
      </div>
    </>
  );
}
