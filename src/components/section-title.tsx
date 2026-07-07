/**
 * SectionTitle — uppercase label for section headers.
 * Replaces the 5× repeated pattern:
 *   <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
 *     Title
 *   </h3>
 *
 * Also replaces the variant with icon:
 *   <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
 *     <Icon className="size-3" />
 *     Title
 *   </h3>
 */
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionTitleProps {
    children: ReactNode;
    icon?: React.ComponentType<{ className?: string }>;
    className?: string;
    as?: "h2" | "h3" | "h4";
}

export function SectionTitle({
    children,
    icon: Icon,
    className,
    as: Tag = "h3",
}: SectionTitleProps) {
    return (
        <Tag
            className={cn(
                "text-xs font-semibold text-muted-subtle uppercase tracking-wider flex items-center gap-1.5",
                className,
            )}
        >
            {Icon && <Icon className="size-3" />}
            {children}
        </Tag>
    );
}
