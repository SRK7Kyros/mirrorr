import { Segmented } from "@/ui/components"

/** The Profiles nav tab hosts two lists: profiles and resolver sources. */
export type ProfilesTab = "profiles" | "sources"

export function ProfilesTabs({
  tab,
  onTab,
}: {
  readonly tab: ProfilesTab
  readonly onTab: (tab: ProfilesTab) => void
}) {
  return (
    <Segmented
      ariaLabel="Profiles and sources"
      active={tab}
      onChange={onTab}
      items={[
        { id: "profiles", label: "Profiles" },
        { id: "sources", label: "Sources" },
      ]}
    />
  )
}
