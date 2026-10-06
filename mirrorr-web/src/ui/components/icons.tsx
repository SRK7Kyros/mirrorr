import type { ReactNode, SVGProps } from "react"

/**
 * Icon set — inline SVG, 24px grid, `currentColor` stroke. No icon font, no
 * runtime network request. Each icon accepts `size` (px, default 18) and any
 * SVG prop; `aria-hidden` is set by default so icons never pollute the
 * accessibility tree unless a caller overrides it.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  readonly size?: number
}

function makeIcon(paths: ReactNode) {
  return function Icon({ size = 18, strokeWidth = 1.75, ...rest }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        {...rest}
      >
        {paths}
      </svg>
    )
  }
}

/* ── navigation ─────────────────────────────────────────────────────── */
export const IconSessions = makeIcon(
  <>
    <path d="M4.9 4.9a10 10 0 0 0 0 14.2" />
    <path d="M19.1 4.9a10 10 0 0 1 0 14.2" />
    <path d="M7.8 7.8a6 6 0 0 0 0 8.4" />
    <path d="M16.2 7.8a6 6 0 0 1 0 8.4" />
    <circle cx="12" cy="12" r="2" />
  </>,
)

export const IconAutoruns = makeIcon(
  <>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <path d="M3 9h18M8 2v4M16 2v4" />
    <path d="M12 13v3l2 1" />
  </>,
)

export const IconRecordings = makeIcon(
  <>
    <rect x="2.5" y="4" width="19" height="16" rx="2" />
    <path d="M2.5 9h19M2.5 15h19M7 4v16M17 4v16" />
  </>,
)

export const IconProfiles = makeIcon(
  <>
    <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
    <circle cx="16" cy="6" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="18" cy="18" r="2" />
  </>,
)

export const IconPlugins = makeIcon(
  <>
    <path d="M12 2v6" />
    <path d="M8 8h8v5a4 4 0 0 1-4 4 4 4 0 0 1-4-4z" />
    <path d="M12 17v5" />
    <path d="M6 8h12" />
  </>,
)

export const IconImportExport = makeIcon(
  <>
    <path d="M7 4v13M7 4 4 7M7 4l3 3" />
    <path d="M17 20V7M17 20l3-3M17 20l-3-3" />
    <path d="M4 20h4M16 4h4" />
  </>,
)

export const IconSettings = makeIcon(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
)

export const IconUsers = makeIcon(
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
)

/* ── chrome / actions ───────────────────────────────────────────────── */
export const IconBell = makeIcon(
  <>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </>,
)

export const IconSearch = makeIcon(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </>,
)

export const IconPlus = makeIcon(<path d="M12 5v14M5 12h14" />)
export const IconMinus = makeIcon(<path d="M5 12h14" />)
export const IconX = makeIcon(<path d="M18 6 6 18M6 6l12 12" />)
export const IconCheck = makeIcon(<path d="M20 6 9 17l-5-5" />)
export const IconChevronDown = makeIcon(<path d="m6 9 6 6 6-6" />)
export const IconChevronRight = makeIcon(<path d="m9 18 6-6-6-6" />)
export const IconChevronLeft = makeIcon(<path d="m15 18-6-6 6-6" />)
export const IconChevronUp = makeIcon(<path d="m18 15-6-6-6 6" />)
export const IconMenu = makeIcon(<path d="M4 6h16M4 12h16M4 18h16" />)
export const IconMoreVertical = makeIcon(
  <>
    <circle cx="12" cy="5" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="12" cy="19" r="1" />
  </>,
)
export const IconLogout = makeIcon(
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5M21 12H9" />
  </>,
)
export const IconUser = makeIcon(
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
)
export const IconRefresh = makeIcon(
  <>
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </>,
)
export const IconTrash = makeIcon(
  <>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6" />
  </>,
)
export const IconPlay = makeIcon(<path d="M6 4l14 8-14 8z" />)
export const IconStop = makeIcon(<rect x="6" y="6" width="12" height="12" rx="1.5" />)
export const IconEdit = makeIcon(
  <>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </>,
)
export const IconDownload = makeIcon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5M12 15V3" />
  </>,
)
export const IconUpload = makeIcon(
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M17 8l-5-5-5 5M12 3v12" />
  </>,
)
export const IconSave = makeIcon(
  <>
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <path d="M17 21v-8H7v8M7 3v5h8" />
  </>,
)
export const IconExternal = makeIcon(
  <>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <path d="M15 3h6v6M10 14 21 3" />
  </>,
)
export const IconCopy = makeIcon(
  <>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </>,
)
export const IconKey = makeIcon(
  <>
    <circle cx="7.5" cy="15.5" r="4.5" />
    <path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l3 3" />
  </>,
)
export const IconShield = makeIcon(
  <>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </>,
)
export const IconLock = makeIcon(
  <>
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
)
export const IconAlert = makeIcon(
  <>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
)
export const IconInfo = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16v-4M12 8h.01" />
  </>,
)
export const IconWifi = makeIcon(
  <>
    <path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M2 9a15 15 0 0 1 20 0" />
    <path d="M12 20h.01" />
  </>,
)
export const IconClock = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
)
export const IconFilter = makeIcon(<path d="M22 3H2l8 9.5V19l4 2v-8.5z" />)
export const IconTerminal = makeIcon(
  <>
    <path d="m4 17 6-6-6-6M12 19h8" />
  </>,
)
export const IconDatabase = makeIcon(
  <>
    <ellipse cx="12" cy="5" rx="9" ry="3" />
    <path d="M3 5v14c0 1.7 4 3 9 3s9-1.3 9-3V5M3 12c0 1.7 4 3 9 3s9-1.3 9-3" />
  </>,
)
export const IconDisc = makeIcon(
  <>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
  </>,
)
export const IconRadio = makeIcon(
  <>
    <circle cx="12" cy="12" r="2" />
    <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4" />
  </>,
)
export const IconEye = makeIcon(
  <>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </>,
)
export const IconSpinner = makeIcon(<path d="M21 12a9 9 0 1 1-6.2-8.6" />)
