/**
 * The administration surface. It lives only in the admin build (`admin.html`):
 * the build served to every other principal does not contain this module, its
 * strings, or any role check that mentions it. nginx picks the build; nothing
 * here decides whether it may run. `admin.tsx` contributes it to the settings
 * page through the generic section slot in `ui/views/settings/sections`.
 *
 * The panels are ordered by urgency — the registration queue holds accounts
 * that cannot sign in, API clients are the calmest — and each panel owns its
 * own toolbar and query gate so a failure in one never blanks the others.
 */
import { Section } from "@/ui/views/shared/page"
import { ApiClientsPanel } from "@/ui/views/admin/api-clients-panel"
import { GroupsPanel } from "@/ui/views/admin/groups-panel"
import { RegistrationRequestsPanel } from "@/ui/views/admin/registration-requests-panel"
import { ResourceAccessPanel } from "@/ui/views/admin/resource-access-panel"
import { UsersPanel } from "@/ui/views/admin/users-panel"

export function AdministrationSection() {
  return (
    <Section
      title="Administration"
      description="Approve sign-ups, manage accounts and groups, and control who can reach each item."
    >
      <RegistrationRequestsPanel />
      <UsersPanel />
      <GroupsPanel />
      <ResourceAccessPanel />
      <ApiClientsPanel />
    </Section>
  )
}
