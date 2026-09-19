/**
 * Reusable detail-header delete button with confirmation.
 *
 * Consolidates the repeated pattern of:
 *   <DeleteConfirm>
 *     <Button variant="ghost" className="h-7 text-xs text-destructive">
 *       {pending ? <Loader2 /> : <Trash2 />} Delete
 *     </Button>
 *   </DeleteConfirm>
 *
 * Used in: sessions, autoruns, recordings, profiles detail headers.
 */

import { Button } from "@/components/ui/button";
import { DeleteConfirm } from "@/components/delete-confirm";
import { Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeleteButtonProps {
	/** Entity name shown in the confirmation dialog, e.g. "Session" or "Profile" */
	entityName: string;
	/** Whether a delete mutation is in progress */
	isPending: boolean;
	/** Callback to execute on confirmed delete */
	onConfirm: () => void;
	/** Optional extra className */
	className?: string;
}

export function DeleteButton({
	entityName,
	isPending,
	onConfirm,
	className,
}: DeleteButtonProps) {
	return (
		<DeleteConfirm
			entityName={entityName}
			isPending={isPending}
			onConfirm={onConfirm}
		>
			<Button
				variant="ghost"
				size="sm"
				className={cn("h-7 text-xs text-destructive", className)}
				disabled={isPending}
			>
				{isPending ? (
					<Loader2 className="size-3 mr-1 animate-spin" />
				) : (
					<Trash2 className="size-3 mr-1" />
				)}
				Delete
			</Button>
		</DeleteConfirm>
	);
}
