/**
 * Shared bulk-delete button used by the sessions, autoruns, recordings, and
 * profiles list pages. Wraps DeleteConfirm + useBulkDelete with a consistent
 * destructive ghost button.
 */
import { Loader2, Trash2 } from "lucide-react";
import { DeleteConfirm } from "@/components/delete-confirm";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useBulkDelete } from "@/hooks/use-bulk-delete";

interface BulkDeleteButtonProps {
	/** API delete function (e.g. sessionsApi.delete). */
	deleteFn: (id: number) => Promise<unknown>;
	/** Entity label used in the confirmation dialog, e.g. "session". */
	entityLabel: string;
	/** Plural entity label used in the button text, e.g. "Sessions". */
	entityLabelPlural: string;
	/** When true for an id, that item must not be deleted (server 409s). */
	isBlocked?: (id: number) => boolean;
	/** Tooltip shown when the button is blocked. */
	blockedReason?: string;
}

export function BulkDeleteButton({
	deleteFn,
	entityLabel,
	entityLabelPlural,
	isBlocked,
	blockedReason,
}: BulkDeleteButtonProps) {
	const { mutate, isPending, selectedIds } = useBulkDelete(
		deleteFn,
		entityLabelPlural,
	);
	const count = selectedIds.size;
	const blockedCount = isBlocked
		? [...selectedIds].filter((id) => isBlocked(id)).length
		: 0;
	const blocked = blockedCount > 0;
	const button = (
		<Button
			variant="ghost"
			size="sm"
			className="h-6 text-micro text-destructive hover:text-destructive"
			disabled={isPending || count === 0 || blocked}
			aria-label={`Bulk delete ${count} ${entityLabel}${count === 1 ? "" : "s"}`}
		>
			{isPending ? (
				<Loader2 className="size-3 mr-1 animate-spin" />
			) : (
				<Trash2 className="size-3 mr-1" />
			)}
			Bulk Delete ({count})
		</Button>
	);
	if (blocked && blockedReason) {
		return (
			<Tooltip>
				<TooltipTrigger
					render={
						<span className="inline-flex cursor-not-allowed">{button}</span>
					}
				/>
				<TooltipContent side="top">
					{blockedReason} ({blockedCount} selected)
				</TooltipContent>
			</Tooltip>
		);
	}
	return (
		<DeleteConfirm
			entityName={`${count} ${entityLabel}${count === 1 ? "" : "s"}`}
			isPending={isPending}
			onConfirm={mutate}
		>
			{button}
		</DeleteConfirm>
	);
}
