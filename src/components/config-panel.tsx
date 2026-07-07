/**
 * ConfigPanel — a labeled config section wrapper.
 * Replaces the duplicated pattern:
 *   <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
 *     <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Title</p>
 *     {content}
 *   </div>
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ConfigPanelProps {
    title: string;
    children: ReactNode;
    className?: string;
    style?: React.CSSProperties;
}

export function ConfigPanel({
    title,
    children,
    className,
    style,
}: ConfigPanelProps) {
    return (
        <div
            className={cn(
                "rounded-lg border bg-muted/10 p-3 space-y-3",
                className,
            )}
            style={style}
        >
            <p className="text-xs text-muted-faint uppercase tracking-wider font-semibold">
                {title}
            </p>
            {children}
        </div>
    );
}
