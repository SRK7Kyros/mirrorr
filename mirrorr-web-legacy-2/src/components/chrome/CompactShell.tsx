/**
 * Spec L489-L491: the shell is selected by CSS breakpoints, not JS route
 * branching. This module owns the ≤639px compact-shell seam — a provider
 * exposing the media query, the primary-action slot the shell's 56px FAB is
 * built in (`CompactFab`), and the override flag a view's `PrimaryAction`
 * raises so its own action replaces the default FAB button instead of the
 * shell and the view forking. The app bar, tab bar and More sheet are
 * siblings of this file.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"

export const COMPACT_SHELL_MEDIA_QUERY = "(max-width: 639px)"
export const COMPACT_PRIMARY_ACTION_ID = "compact-primary-action"

interface CompactShellValue {
  readonly compact: boolean
  readonly hasViewAction: boolean
  readonly declareViewAction: (next: boolean) => void
}

const CompactShellContext = createContext<CompactShellValue>({
  compact: false,
  hasViewAction: false,
  declareViewAction: () => undefined,
})

export function useIsCompactShell(): boolean {
  return useContext(CompactShellContext).compact
}

export function useHasViewPrimaryAction(): boolean {
  return useContext(CompactShellContext).hasViewAction
}

export function useDeclareViewPrimaryAction(): (next: boolean) => void {
  return useContext(CompactShellContext).declareViewAction
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
  const [hasViewAction, setHasViewAction] = useState(false)
  const declareViewAction = useCallback((next: boolean) => setHasViewAction(next), [])
  const value = useMemo(
    () => ({ compact, hasViewAction, declareViewAction }),
    [compact, hasViewAction, declareViewAction],
  )

  return <CompactShellContext.Provider value={value}>{children}</CompactShellContext.Provider>
}

export interface PrimaryActionProps {
  readonly children: ReactNode
}

/**
 * The view's single primary action. Under the compact shell it is portalled
 * into the shell's fixed FAB slot and suppresses the shell's default button;
 * otherwise it stays inline where the view put it (the desktop top-right
 * action) or falls back inline if no slot is mounted.
 */
export function PrimaryAction({ children }: PrimaryActionProps) {
  const compact = useIsCompactShell()
  const declareViewAction = useDeclareViewPrimaryAction()
  const [host, setHost] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setHost(compact ? document.getElementById(COMPACT_PRIMARY_ACTION_ID) : null)
  }, [compact])

  useEffect(() => {
    if (host === null) return
    declareViewAction(true)
    return () => declareViewAction(false)
  }, [host, declareViewAction])

  if (compact && host !== null) return createPortal(children, host)

  return <>{children}</>
}
