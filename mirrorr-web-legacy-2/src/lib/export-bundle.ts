/**
 * Single-profile / single-autorun bundle download — spec L295, L331, L546,
 * L614 and contract §9/§13.5.
 *
 * Shared by the desktop row button and the compact action sheet so both trigger
 * the same authenticated fetch and the same `.json` download. Whether a failed
 * download falls back to the copy dialog is the caller's decision.
 */
import { downloadJson } from "@/lib/download"
import { exportAutorunBundle, exportProfileBundle } from "@/lib/import-export-api"

export type BundleKind = "profile" | "autorun"

export interface BundleExportOutcome {
  readonly downloaded: boolean
  readonly text: string
}

export async function exportBundleToFile(kind: BundleKind, id: number): Promise<BundleExportOutcome> {
  const text = kind === "profile" ? await exportProfileBundle(id) : await exportAutorunBundle(id)
  return { downloaded: downloadJson(`${kind}-${id}.json`, text), text }
}
