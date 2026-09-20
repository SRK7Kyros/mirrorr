/**
 * Profile row actions — spec L323-L337, contract §3/§13.6.
 *
 * The desktop row and the compact action sheet share one action set: Use (opens
 * D1 prefilled), Edit, Export (the single-profile bundle) and Delete (the
 * caller's reference pre-scan plus ConfirmDialog). Keeping both presentations on
 * one factory means the compact sheet cannot drift from the desktop row.
 */
import { Trash2 } from "lucide-react"
import { ExportBundleButton } from "@/components/import-export/ExportBundleButton"
import type { ActionSheetItem } from "@/components/ui/ActionSheet"
import { Button } from "@/components/ui/Button"
import type { Profile } from "@/lib/schemas/plugins"

export interface ProfileActionItemArgs {
  readonly profile: Profile
  readonly exportDisabled: boolean
  readonly onUse: () => void
  readonly onEdit: () => void
  readonly onExport: () => void
  readonly onDelete: () => void
}

export function profileActionItems(args: ProfileActionItemArgs): readonly ActionSheetItem[] {
  return [
    { id: "use", label: "Use", onSelect: args.onUse },
    { id: "edit", label: "Edit", onSelect: args.onEdit },
    { id: "export", label: "Export", disabled: args.exportDisabled, onSelect: args.onExport },
    { id: "delete", label: "Delete", tone: "danger", disabled: args.exportDisabled, onSelect: args.onDelete },
  ]
}

export interface ProfileRowActionsProps {
  readonly profile: Profile
  readonly pending: boolean
  readonly onUse: () => void
  readonly onEdit: () => void
  readonly onDelete: () => void
}

export function ProfileRowActions({ profile, pending, onUse, onEdit, onDelete }: ProfileRowActionsProps) {
  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" variant="secondary" onClick={onUse}>
        Use
      </Button>
      <Button size="sm" variant="secondary" aria-label={`Edit ${profile.name}`} onClick={onEdit}>
        Edit
      </Button>
      <ExportBundleButton kind="profile" id={profile.id} name={profile.name} disabled={pending} />
      <Button
        size="sm"
        variant="ghost"
        icon={Trash2}
        aria-label={`Delete ${profile.name}`}
        disabled={pending}
        onClick={onDelete}
      />
    </div>
  )
}
