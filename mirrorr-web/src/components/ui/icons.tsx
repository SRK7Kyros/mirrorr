import type { ReactNode, SVGProps } from "react"

/**
 * Inline SVG stroke icons only (§1.4/§6: 1.75px stroke, 20px box on acrylic /
 * 16px in opaque chips, currentColor, no icon font, **no emoji**). 24-unit
 * viewBox, sized by `size`.
 */
export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "width" | "height"> {
  readonly size?: number
  readonly strokeWidth?: number
}

function Svg({ size = 16, strokeWidth = 1.75, children, ...rest }: IconProps & { children: ReactNode }) {
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
      {children}
    </svg>
  )
}

/* ── navigation ───────────────────────────────────────────────────────── */

export function IconSessions(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  )
}

export function IconAutoruns(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </Svg>
  )
}

export function IconRecordings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="2.5" />
    </Svg>
  )
}

export function IconProfiles(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 19c1.5-3 4-4.5 7-4.5s5.5 1.5 7 4.5" />
    </Svg>
  )
}

export function IconPlugins(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0V7z" />
      <path d="M12 16v5" />
    </Svg>
  )
}

export function IconImportExport(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 20V5M7 5l-3 3M7 5l3 3" />
      <path d="M17 4v15M17 19l3-3M17 19l-3-3" />
    </Svg>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6L18 18M18 6l-1.4 1.4M7.4 16.6L6 18" />
    </Svg>
  )
}

/* ── chrome ───────────────────────────────────────────────────────────── */

export function IconBell(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Svg>
  )
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m6 9 6 6 6-6" />
    </Svg>
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m14 6-6 6 6 6" />
    </Svg>
  )
}

export function IconMoreH(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={0}>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </Svg>
  )
}

/* ── generic ──────────────────────────────────────────────────────────── */

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m5 12 5 5L19 7" />
    </Svg>
  )
}

export function IconX(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  )
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />
    </Svg>
  )
}

/* ── §1.4 status shapes (icon + word doubling is mandatory) ───────────── */

/** scheduled — clock: circle, two hands */
export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l2.5 1.5" />
    </Svg>
  )
}

/** active — play: triangle in circle */
export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M10 9l5 3-5 3z" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** recording — record: filled disc in ring */
export function IconRecord(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** terminating — stop: square in circle */
export function IconStop(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" fill="currentColor" stroke="none" />
    </Svg>
  )
}

/** remuxing — two arrows, box */
export function IconRemux(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="7" width="16" height="10" rx="1.5" />
      <path d="M8 12h8M13.5 9.5 16 12l-2.5 2.5" />
    </Svg>
  )
}

/** finalizing — package: sealed box */
export function IconPackage(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M4 8l8 4 8-4M12 12v8" />
    </Svg>
  )
}

/** unknown — help: circle, question */
export function IconHelp(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 .9-1 1.7" />
      <path d="M12 16.5h.01" />
    </Svg>
  )
}
