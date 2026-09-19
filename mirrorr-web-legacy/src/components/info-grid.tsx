import type { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface InfoField {
	label: string;
	value: ReactNode;
}

interface InfoGridProps {
	fields: InfoField[];
	className?: string;
}

export function InfoGrid({ fields, className }: InfoGridProps) {
	const isMobile = useIsMobile();
	return (
		<div
			className={cn(
				"info-grid grid gap-x-4 gap-y-1 justify-items-start w-fit max-w-full",
				isMobile && "w-full",
				className,
			)}
			style={
				isMobile
					? { gridTemplateColumns: "1fr 1fr" }
					: {
							gridTemplateRows: "auto auto",
							gridAutoFlow: "column",
							gridAutoColumns: "auto",
						}
			}
		>
			{fields.map((f) => (
				<div
					key={f.label}
					className="grid gap-y-px"
					style={{ gridRow: "span 2", gridTemplateRows: "subgrid" }}
				>
					<span className="text-xs text-muted-foreground">{f.label}</span>
					<span className="text-xs">{f.value}</span>
				</div>
			))}
		</div>
	);
}
