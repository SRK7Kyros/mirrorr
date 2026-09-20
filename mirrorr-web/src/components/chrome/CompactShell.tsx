/**
 * Spec L489-L491: the shell is selected by CSS breakpoints, not JS route
 * branching. This module owns the ≤639px compact-shell seam only — a provider
 * exposing the media query, and the primary-action slot every view's action
 * renders into (see the spec's 56px FAB). The full compact chrome (app bar,
 * tab bar, More sheet) is a later todo.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

export const COMPACT_SHELL_MEDIA_QUERY = "(max-width: 639px)"
export const COMPACT_PRIMARY_ACTION_ID = "compact-primary-action"

const CompactShellContext = createContext(false)

export function useIsCompactShell(): boolean {
  return useContext(CompactShellContext)
}

function subscribeToCompactShell(listener: () => void): () => void {
  const mediaQuery = window.matchMedia(COMPACT_SHELL_MEDIA_QUERY)
  mediaQuery.addEventListener("change", listener)
  return () => mediaQuery.removeEventListener("change", listener)
}

function getCompactShellSnapshot(): boolean {
  return window.matchMedia(COMPACT_SHELL_MEDIA_QUERY).matches
}

function getCompactShellServerSnapshot(): boolean {
  return false
}

export interface CompactShellProviderProps {
  readonly children: ReactNode
}

export function CompactShellProvider({ children }: CompactShellProviderProps) {
  const compact = useSyncExternalStore(
    subscribeToCompactShell,
    getCompactShellSnapshot,
    getCompactShellServerSnapshot,
  )

  return <CompactShellContext.Provider value={compact}>{children}</CompactShellContext.Provider>
}

export interface PrimaryActionProps {
  readonly children: ReactNode
}

/**
 * The view's single primary action. Under the compact shell it is portalled
 * into the shell's fixed slot; otherwise it stays inline where the view put it
 * (the desktop top-right action) or falls back inline if no slot is mounted.
 */
export function PrimaryAction({ children }: PrimaryActionProps) {
  const compact = useIsCompactShell()
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(compact ? document.getElementById(COMPACT_PRIMARY_ACTION_ID) : null)
  }, [compact])

  if (compact && host !== null) return createPortal(children, host)

  return <>{children}</>
}
