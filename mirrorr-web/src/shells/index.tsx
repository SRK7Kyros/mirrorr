import { useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { ShellA } from "@/shells/a"
import { ShellB, ShellBChromeProvider } from "@/shells/b"
import type { ShellBChrome } from "@/shells/b"

/**
 * shells/index — the variants live side by side in ONE build so they can be
 * compared on the same data, at the same URL, before either is deployed.
 *
 * Selection order: `?shell=a|b` in the URL wins, then the last choice made in
 * this browser, then `DEFAULT_VARIANT`. The chosen link is rewritten with
 * `replaceState` so the parameter survives navigation and a reload, and it is
 * readable from any route without touching the router's search schema.
 *
 * Delete this file together with the losing variant once the choice is made.
 */

export type ShellVariant = "a" | "b"

export const DEFAULT_VARIANT: ShellVariant = "a"

const STORAGE_KEY = "mirrorr.shell"

const listeners = new Set<() => void>()

function isVariant(value: string | null | undefined): value is ShellVariant {
  return value === "a" || value === "b"
}

function read(): ShellVariant {
  const fromUrl = new URLSearchParams(window.location.search).get("shell")
  if (isVariant(fromUrl)) return fromUrl

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (isVariant(stored)) return stored
  } catch {
    /* private mode / storage disabled — the default is still correct */
  }
  return DEFAULT_VARIANT
}

function write(variant: ShellVariant): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, variant)
  } catch {
    /* non-fatal: the URL parameter alone still selects the variant */
  }

  /* Keep the address bar (and the next reload) on the chosen variant, using
     replaceState so a toggle never adds a history entry. */
  const url = new URL(window.location.href)
  if (url.searchParams.get("shell") === variant) return
  url.searchParams.set("shell", variant)
  window.history.replaceState(window.history.state, "", url)

  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useShellVariant(): { readonly variant: ShellVariant; readonly setVariant: (v: ShellVariant) => void } {
  const variant = useSyncExternalStore(subscribe, read, () => DEFAULT_VARIANT)
  return { variant, setVariant: write }
}

/**
 * The switch itself. Deliberately plain markup with inline positioning: it is
 * NOT part of either design (it disappears with the losing variant) and it must
 * stay legible over Variant A's light backdrop and Variant B's dark spine.
 */
function VariantSwitch() {
  const { variant, setVariant } = useShellVariant()

  return (
    <div
      style={{
        position: "fixed",
        right: 12,
        bottom: 12,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        borderRadius: 8,
        background: "rgba(20,20,20,0.92)",
        color: "#ffffff",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 11,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
      }}
    >
      <span aria-hidden="true" style={{ opacity: 0.7 }}>
        Shell
      </span>
      {(["a", "b"] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setVariant(option)}
          aria-pressed={variant === option}
          style={{
            appearance: "none",
            border: 0,
            cursor: "pointer",
            padding: "2px 8px",
            borderRadius: 4,
            font: "inherit",
            letterSpacing: "inherit",
            textTransform: "inherit",
            background: variant === option ? "#ffffff" : "transparent",
            color: variant === option ? "#141414" : "#ffffff",
          }}
        >
          {option === "a" ? "A safe" : "B experimental"}
        </button>
      ))}
    </div>
  )
}

export interface AppShellProps {
  readonly children: ReactNode
  /**
   * Chrome content for Variant B's capsule / instrument band / monitor-wall.
   * Variant A derives the same information from the route and realtime state on
   * its own, so this is ignored when A is active.
   */
  readonly chrome?: ShellBChrome
}

/** Mounts whichever variant is selected, plus the temporary switch. */
export function AppShell({ children, chrome }: AppShellProps) {
  const { variant } = useShellVariant()

  return (
    <>
      {variant === "b" ? (
        <ShellBChromeProvider chrome={chrome ?? {}}>
          <ShellB>{children}</ShellB>
        </ShellBChromeProvider>
      ) : (
        <ShellA>{children}</ShellA>
      )}
      <VariantSwitch />
    </>
  )
}

export { ShellA, ShellB }
