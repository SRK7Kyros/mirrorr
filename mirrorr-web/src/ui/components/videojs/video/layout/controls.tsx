import { Controls, Time, Tooltip } from '@videojs/react';
import type { ComponentProps } from 'react';

import { AirPlayButton } from '@/ui/components/videojs/ui/airplay-button';
import { ButtonTooltip } from '@/ui/components/videojs/ui/button-tooltip';
import { CaptionsButton } from '@/ui/components/videojs/ui/captions-button';
import { CastButton } from '@/ui/components/videojs/ui/cast-button';
import { FullscreenButton } from '@/ui/components/videojs/ui/fullscreen-button';
import { PiPButton } from '@/ui/components/videojs/ui/pip-button';
import { PlayButton } from '@/ui/components/videojs/ui/play-button';
import { SeekButton } from '@/ui/components/videojs/ui/seek-button';
import { TimeSlider } from '@/ui/components/videojs/ui/time-slider';
import { VolumePopover } from '@/ui/components/videojs/ui/volume-popover';
import { cn } from '@/ui/lib/resolve-class-name';

import { VideoSettingsMenu } from '../menus/settings-menu';

export interface DefaultVideoControlsProps {
  renderThumbnail?: NonNullable<ComponentProps<typeof TimeSlider>>['renderThumbnail'];
}

export function DefaultVideoControls({ renderThumbnail }: DefaultVideoControlsProps = {}) {
  return (
    <Controls.Root>
      <Controls.Backdrop className={'video-controls-backdrop'} />
      <Controls.Content className={cn('video-controls', 'video-controls-content')}>
        <Tooltip.Provider>
          <Controls.Group className={'video-controls-primary'}>
            <ButtonTooltip side="top">
              <SeekButton seconds={-10} />
            </ButtonTooltip>
            <ButtonTooltip side="top">
              <PlayButton />
            </ButtonTooltip>
            <VolumePopover className={'video-controls-volume-button'} />

            <Controls.Group className={'video-time-slider-group'}>
              <Time.Value className={cn('media-time-value', 'video-time-value')} type="current" />
              <TimeSlider renderThumbnail={renderThumbnail} />
              <Time.Value className={cn('media-time-toggle', 'video-time-value')} type="remaining" toggle />
            </Controls.Group>

            <ButtonTooltip side="top">
              <CaptionsButton className={'video-controls-captions-button'} />
            </ButtonTooltip>
            <VideoSettingsMenu className={'video-controls-settings-button'} />
          </Controls.Group>

          <Controls.Group className={'video-controls-secondary'}>
            <ButtonTooltip side="top">
              <CastButton />
            </ButtonTooltip>
            <ButtonTooltip side="top">
              <AirPlayButton />
            </ButtonTooltip>
            <ButtonTooltip side="top">
              <PiPButton />
            </ButtonTooltip>
            <ButtonTooltip side="top">
              <FullscreenButton />
            </ButtonTooltip>
          </Controls.Group>
        </Tooltip.Provider>
      </Controls.Content>
    </Controls.Root>
  );
}
