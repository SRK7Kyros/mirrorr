/**
 * Reusable inline delete button for sidebar entries.
 * Used in recordings/index.tsx and profiles/index.tsx.
 *
 * Supports:
 * - Click to delete
 * - Delete key shortcut when focused
 * - Right-click context menu
 */

import { Loader2, Trash2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

interface InlineDeleteButtonProps {
	id: number;
	isPending: boolean;
	isActive: boolean;
	onClick: (e: React.MouseEvent) => void;
}

export function InlineDeleteButton({
	isPending,
	isActive,
	onClick,
}: InlineDeleteButtonProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const [showContextMenu, setShowContextMenu] = useState(false);
	const [contextPos, setContextPos] = useState({ x: 0, y: 0 });

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				e.stopPropagation();
				// Create a synthetic mouse event for the click handler
				const syntheticEvent = {
					stopPropagation: () => {},
					preventDefault: () => {},
				} as React.MouseEvent;
				onClick(syntheticEvent);
			}
		},
		[onClick],
	);

	const handleContextMenu = useCallback((e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setContextPos({ x: e.clientX, y: e.clientY });
		setShowContextMenu(true);
	}, []);

	const handleContextAction = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			setShowContextMenu(false);
			onClick(e);
		},
		[onClick],
	);

	// Close context menu when clicking elsewhere
	const handleBlur = useCallback(() => {
		setTimeout(() => setShowContextMenu(false), 150);
	}, []);

	return (
		<div
			className="relative"
			onBlur={handleBlur}
			onContextMenu={handleContextMenu}
		>
			<Button
				ref={buttonRef}
				variant="ghost"
				size="icon-xs"
				className="ml-auto shrink-0 opacity-0 group-hover:opacity-100 hover:text-destructive"
				onClick={onClick}
				onKeyDown={handleKeyDown}
				tabIndex={0}
				disabled={isPending && isActive}
			>
				{isPending && isActive ? (
					<Loader2 className="size-3 animate-spin" />
				) : (
					<Trash2 className="size-3" />
				)}
			</Button>

			{showContextMenu && (
				<div
					className="fixed z-50 min-w-[160px] bg-popover border rounded-md shadow-md p-1"
					style={{ left: contextPos.x, top: contextPos.y }}
				>
					<button
						type="button"
						className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-sm"
						onClick={handleContextAction}
					>
						<Trash2 className="size-3" />
						Delete
					</button>
				</div>
			)}
		</div>
	);
}
