/**
 * MetadataBar — wraps a row of label/value pairs with dot separators.
 * Replaces the duplicated pattern:
 *   <div className="rounded-lg border bg-muted/20 px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
 *     <span className="inline-flex items-center gap-1.5">
 *       <span className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Label</span>
 *       ...
 *     </span>
 *     <span className="text-border">·</span>
 *     ...
 *   </div>
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MetadataBarProps {
    children: ReactNode;
    className?: string;
}

export function MetadataBar({ children, className }: MetadataBarProps) {
    return (
        <div
            className={cn(
                "rounded-lg border bg-muted/20 px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground",
                className,
            )}
        >
            {children}
        </div>
    );
}

interface MetadataItemProps {
    label: string;
    children: ReactNode;
    className?: string;
}

export function MetadataItem({
    label,
    children,
    className,
}: MetadataItemProps) {
    return (
        <span className={cn("inline-flex items-center gap-1.5", className)}>
            <span className="text-muted-subtle text-[10px] uppercase tracking-wider">
                {label}
            </span>
            {children}
        </span>
    );
}

export function MetadataSeparator() {
    return <span className="text-border">·</span>;
}
