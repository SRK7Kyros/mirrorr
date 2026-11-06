import { deleteAutorun, deleteProfile, fetchAutorunPage, fetchProfilePage } from "@/api/endpoints"
import { fetchAllLookupPages } from "@/api/query-keys"
import type { Autorun, Profile } from "@/api/schemas"
import type { CreatedNames } from "./import-logic"

/**
 * Undo for an applied import.
 *
 * The apply endpoint answers with counts only, so the view cannot name the rows
 * it just created. Instead it records the highest id of each collection before
 * applying and afterwards deletes only rows above that watermark whose name is
 * one the bundle asked for — a concurrent create by someone else therefore
 * survives unless it shares the imported name.
 */

export interface ImportWatermark {
  readonly profileId: number
  readonly autorunId: number
}

const highestId = (rows: readonly { readonly id: number }[]): number =>
  rows.reduce((max, row) => Math.max(max, row.id), 0)

export async function readWatermark(): Promise<ImportWatermark> {
  const [profiles, autoruns] = await Promise.all([
    fetchAllLookupPages<Profile>((cursor) => fetchProfilePage(cursor)),
    fetchAllLookupPages<Autorun>((cursor) => fetchAutorunPage(cursor)),
  ])
  return { profileId: highestId(profiles), autorunId: highestId(autoruns) }
}

/** Deletes what the import created; returns how many rows went away. */
export async function revertImport(mark: ImportWatermark, names: CreatedNames): Promise<number> {
  const [profiles, autoruns] = await Promise.all([
    fetchAllLookupPages<Profile>((cursor) => fetchProfilePage(cursor)),
    fetchAllLookupPages<Autorun>((cursor) => fetchAutorunPage(cursor)),
  ])
  const wantedAutoruns = new Set(names.autoruns)
  const wantedProfiles = new Set(names.profiles)

  const createdAutoruns = autoruns.filter(
    (row) => row.id > mark.autorunId && wantedAutoruns.has(row.user_friendly_name),
  )
  const createdProfiles = profiles.filter((row) => row.id > mark.profileId && wantedProfiles.has(row.name))

  // Autoruns first: a profile delete may otherwise report the autorun it still
  // backs, and the pair would be left half-removed.
  for (const row of createdAutoruns) await deleteAutorun(row.id)
  for (const row of createdProfiles) await deleteProfile(row.id)
  return createdAutoruns.length + createdProfiles.length
}
