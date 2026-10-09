import type { NameMaps } from "@/api"
import type { Session } from "@/api/schemas"

/** What a session is called: the autorun that spawned it, else the profile it
 * runs, else its id. */
export function sessionTitle(session: Session, names: NameMaps): string {
  if (session.autorun_name != null && session.autorun_name !== "") return session.autorun_name
  const profile =
    session.profile_name ??
    (session.profile_id != null ? names.profiles.get(session.profile_id) : undefined)
  if (profile != null && profile !== "") return profile
  return `#${session.id}`
}
