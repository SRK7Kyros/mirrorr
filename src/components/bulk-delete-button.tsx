/**
 * Shared bulk-delete button used by the sessions, autoruns, recordings, and
 * profiles list pages. Wraps DeleteConfirm + useBulkDelete with a consistent
 * destructive ghost button.
 */
import { Loader2, Trash2 } from "lucide-react";
import { DeleteConfirm } from "@/components/delete-confirm";
import { Button } from "@/components/ui/button";
import { useBulkDelete } from "@/hooks/use-bulk-delete";

interface BulkDeleteButtonProps {
	/** API delete function (e.g. sessionsApi.delete). */
	deleteFn: (id: number) => Promise<unknown>;
	/** Entity label used in the confirmation dialog, e.g. "session". */
	entityLabel: string;
	/** Plural entity label used in the button text, e.g. "Sessions". */
	entityLabelPlural: string;
}

export function BulkDeleteButton({
	deleteFn,
	entityLabel,
	entityLabelPlural,
}: BulkDeleteButtonProps) {
	const { mutate, isPending, selectedIds } = useBulkDelete(
		deleteFn,
		entityLabelPlural,
	);
	const count = selectedIds.size;
	return (
		<DeleteConfirm
			entityName={`${count} ${entityLabel}${count === 1 ? "" : "s"}`}
			isPending={isPending}
			onConfirm={mutate}
		>
			<Button
				variant="ghost"
				size="sm"
				className="h-6 text-micro text-destructive hover:text-destructive"
				disabled={isPending || count === 0}
				aria-label={`Bulk delete ${count} ${entityLabel}${count === 1 ? "" : "s"}`}
			>
				{isPending ? (
					<Loader2 className="size-3 mr-1 animate-spin" />
				) : (
					<Trash2 className="size-3 mr-1" />
				)}
				Bulk Delete ({count})
			</Button>
		</DeleteConfirm>
	);
}
