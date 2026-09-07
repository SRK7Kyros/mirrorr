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
import { cloneElement, isValidElement, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
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
	/** When true the trigger renders disabled (e.g. server 409s while remuxing). */
	disabled?: boolean;
	/** Tooltip shown when disabled. */
	disabledReason?: string;
}

export function DeleteConfirm({
	entityName,
	isPending,
	onConfirm,
	children,
	variant = "ghost",
	size = "icon-xs",
	className,
	disabled = false,
	disabledReason,
}: DeleteConfirmProps) {
	const [open, setOpen] = useState(false);
	const blocked = disabled || isPending;

	const defaultButton = (
		<Button
			variant={variant}
			size={size}
			className={className}
			disabled={blocked}
		>
			{isPending ? (
				<Loader2 className="size-3 animate-spin" />
			) : (
				<Trash2 className="size-3" />
			)}
		</Button>
	);

	const childTrigger =
		children &&
		typeof children !== "string" &&
		typeof children !== "number" &&
		isValidElement<{ disabled?: boolean }>(children)
			? cloneElement(children, {
					disabled: blocked || children.props.disabled,
				})
			: null;

	const trigger = childTrigger ? (
		<AlertDialogTrigger render={childTrigger} />
	) : (
		<AlertDialogTrigger render={defaultButton} />
	);

	const blockedTrigger = (
		<Tooltip>
			<TooltipTrigger
				render={
					<span className="inline-flex cursor-not-allowed">
						{childTrigger ?? defaultButton}
					</span>
				}
			/>
			<TooltipContent side="top">{disabledReason}</TooltipContent>
		</Tooltip>
	);

	return (
		<AlertDialog open={open} onOpenChange={setOpen}>
			{disabled && disabledReason ? blockedTrigger : trigger}
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {entityName}</AlertDialogTitle>
					<AlertDialogDescription>
						Are you sure you want to delete this {entityName.toLowerCase()}?
						This action cannot be undone.
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
