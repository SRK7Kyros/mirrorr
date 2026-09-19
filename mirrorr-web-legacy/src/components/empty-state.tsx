/**
 * EmptyState — centered empty state with icon and message.
 * Replaces:
 *   - EmptyDetail (resource-layout.tsx) — h-full variant
 *   - network-monitor empty — h-32 variant
 *   - monitoring page empty — h-full variant
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
	icon?: React.ComponentType<{ className?: string }>;
	text: string;
	/** Height variant. Default fills parent. */
	height?: "full" | "sm" | "md";
	className?: string;
	children?: ReactNode;
	/** Optional actions below the message (e.g. a "New" or navigation link). */
	actions?: ReactNode;
}

const heightClass = {
	full: "h-full",
	sm: "h-32",
	md: "h-[150px]",
} as const;

export function EmptyState({
	icon: Icon,
	text,
	height = "full",
	className,
	children,
	actions,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center text-muted-foreground",
				heightClass[height],
				className,
			)}
		>
			{Icon && <Icon className="size-8 mb-2 opacity-15" />}
			<p className="text-xs">{text}</p>
			{actions && <div className="mt-2">{actions}</div>}
			{children}
		</div>
	);
}
