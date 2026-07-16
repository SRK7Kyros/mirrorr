/**
 * Reusable delete confirmation dialog.
 * Wraps AlertDialog to provide consistent delete confirmation UX.
 */
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2 } from "lucide-react";

interface DeleteConfirmProps {
	/** The entity name to display in the confirmation */
	entityName: string;
	/** Whether the delete operation is in progress */
	isPending: boolean;
	/** Callback when delete is confirmed */
	onConfirm: () => void;
	/** Optional: render as trigger element instead of default button */
	children?: React.ReactNode;
	/** Optional: variant for the trigger button */
	variant?: "ghost" | "destructive" | "outline" | "default";
	/** Optional: size for the trigger button */
	size?: "default" | "sm" | "icon" | "icon-xs";
	/** Optional: additional className for the trigger button */
	className?: string;
}

export function DeleteConfirm({
	entityName,
	isPending,
	onConfirm,
	children,
	variant = "ghost",
	size = "icon-xs",
	className,
}: DeleteConfirmProps) {
	const [open, setOpen] = useState(false);

	const defaultButton = (
		<Button
			variant={variant}
			size={size}
			className={className}
			disabled={isPending}
		>
			{isPending ? (
				<Loader2 className="size-3 animate-spin" />
			) : (
				<Trash2 className="size-3" />
			)}
		</Button>
	);

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			{/* If children is a single ReactElement, use render prop; otherwise wrap in a span */}
			{children && typeof children !== "string" && typeof children !== "number" ? (
				<AlertDialogTrigger render={children as React.ReactElement} />
			) : (
				<AlertDialogTrigger render={defaultButton} />
			)}
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {entityName}</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to delete this {entityName.toLowerCase()}? This action
						cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => {
							onConfirm();
							setOpen(false);
						}}
						disabled={isPending}
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
					>
						{isPending ? (
							<Loader2 className="mr-2 size-3 animate-spin" />
						) : (
							<Trash2 className="mr-2 size-3" />
						)}
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
