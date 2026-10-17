import {
  createContext,
  useContext,
  type ComponentType,
  type ReactNode,
} from "react";
import type { ResourceType } from "@/api/schemas/privileged";

/** One selected element, as a list hands it to the bulk panel. */
export interface AccessItemRef {
  readonly id: number;
  readonly label: string;
}

export interface ResourceAccessButtonProps {
  readonly resourceType: ResourceType;
  readonly id: number;
  readonly label: string;
}

export interface ResourceAccessBulkActionProps {
  readonly resourceType: ResourceType;
  readonly items: readonly AccessItemRef[];
}

export interface ResourceAccessSlot {
  readonly Button: ComponentType<ResourceAccessButtonProps>;
  readonly BulkAction: ComponentType<ResourceAccessBulkActionProps>;
}

export const ResourceAccessSlotContext =
  createContext<ResourceAccessSlot | null>(null);

export function useResourceAccessSlot(): ResourceAccessSlot | null {
  return useContext(ResourceAccessSlotContext);
}

/** Renders the admin access button on an element, or nothing in a build without the slot. */
export function AccessButton(props: ResourceAccessButtonProps): ReactNode {
  const slot = useResourceAccessSlot();
  return slot === null ? null : <slot.Button {...props} />;
}

/** Renders the admin bulk-access action in a bulk bar, or nothing without the slot. */
export function AccessBulkAction(
  props: ResourceAccessBulkActionProps,
): ReactNode {
  const slot = useResourceAccessSlot();
  return slot === null ? null : <slot.BulkAction {...props} />;
}
