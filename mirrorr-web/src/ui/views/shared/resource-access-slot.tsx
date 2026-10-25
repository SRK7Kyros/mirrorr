import { createContext, useContext, useState, type ComponentType, type ReactNode } from "react"
import type { AccessTarget } from "@/api/domain/access-plan"
import type { ResourceType } from "@/api/schemas/privileged"
import type { BulkAction } from "@/ui/components/BulkBar"
import { IconUser } from "@/ui/components/icons"

/** One selected element, as a list hands it to the bulk panel. */
export interface AccessItemRef {
  readonly id: number
  readonly label: string
}

export interface ResourceAccessButtonProps {
  readonly resourceType: ResourceType
  readonly id: number
  readonly label: string
}

export interface ResourceAccessBulkDialogProps {
  readonly resourceType: ResourceType
  readonly items: readonly AccessItemRef[]
  readonly onClose: () => void
}

/**
 * A creation panel's access section. It reports its draft on mount and after
 * every edit; the form keeps the last report and hands it to `applyCreation`
 * once the core has answered with an id.
 */
export interface ResourceAccessCreationProps {
  readonly resourceType: ResourceType
  readonly onChange: (target: AccessTarget) => void
  readonly busy?: boolean
}

export interface ResourceAccessSlot {
  readonly Button: ComponentType<ResourceAccessButtonProps>
  readonly BulkDialog: ComponentType<ResourceAccessBulkDialogProps>
  readonly Creation: ComponentType<ResourceAccessCreationProps>
  /** Applies a creation draft to the row just created. Throws on a failed op. */
  readonly applyCreation: (
    resourceType: ResourceType,
    id: number,
    target: AccessTarget,
  ) => Promise<void>
}

export const ResourceAccessSlotContext = createContext<ResourceAccessSlot | null>(null)

export function useResourceAccessSlot(): ResourceAccessSlot | null {
  return useContext(ResourceAccessSlotContext)
}

/** Renders the admin access button on an element, or nothing in a build without the slot. */
export function AccessButton(props: ResourceAccessButtonProps): ReactNode {
  const slot = useResourceAccessSlot()
  return slot === null ? null : <slot.Button {...props} />
}

/**
 * The bulk bar's access action, in the shape `BulkBar` takes actions in, plus
 * the panel to render beside it. A build without the slot answers neither, so
 * the list itself never has to branch.
 */
export function useBulkAccessAction(
  resourceType: ResourceType,
  items: readonly AccessItemRef[],
): { readonly action: BulkAction | null; readonly dialog: ReactNode } {
  const slot = useResourceAccessSlot()
  const [open, setOpen] = useState(false)

  if (slot === null) return { action: null, dialog: null }

  return {
    action: {
      key: "access",
      label: "Access",
      icon: <IconUser size={15} />,
      disabled: items.length === 0,
      onClick: () => setOpen(true),
    },
    dialog: open ? (
      <slot.BulkDialog resourceType={resourceType} items={items} onClose={() => setOpen(false)} />
    ) : null,
  }
}

/** Renders the admin access section in a creation panel, or nothing without the slot. */
export function AccessCreation(props: ResourceAccessCreationProps): ReactNode {
  const slot = useResourceAccessSlot()
  return slot === null ? null : <slot.Creation {...props} />
}

/** The slot's create-time applier, or null in a build that cannot apply one. */
export function useCreationAccessApplier(): ResourceAccessSlot["applyCreation"] | null {
  return useResourceAccessSlot()?.applyCreation ?? null
}
