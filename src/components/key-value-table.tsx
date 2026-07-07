import { isValidElement } from "react";
import { CopyButton } from "@/components/schema-viewer";
import { JsonModal } from "@/components/json-modal";
import { SectionCard } from "@/components/section-card";
import { Button } from "@/components/ui/button";
import { Braces } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KeyValueTableProps {
    title: string;
    entries: [string, unknown][];
    emptyText?: string;
    /** Show a "Raw JSON" button that opens the raw JSON in a modal */
    json?: unknown;
    /** Render the value cell custom. Receives the raw value and should return a ReactNode. */
    renderValue?: (key: string, value: unknown) => ReactNode;
    /** Align values to the left instead of the default right */
    leftAlignValues?: boolean;
}

export function KeyValueTable({
    title,
    entries,
    emptyText,
    json,
    renderValue,
    leftAlignValues,
}: KeyValueTableProps) {
    const isEmpty = entries.length === 0;

    return (
        <SectionCard
            title={title}
            actions={
                json !== undefined && !isEmpty ? (
                    <JsonModal
                        title={title}
                        data={json}
                        trigger={(onClick) => (
                            <Button variant="ghost" size="xs" onClick={onClick}>
                                <Braces className="size-3" />
                                Raw JSON
                            </Button>
                        )}
                    />
                ) : undefined
            }
        >
            {isEmpty ? (
                <p className="text-xs text-muted-ghost py-4 text-center">
                    {emptyText ?? "No properties"}
                </p>
            ) : (
                <table className="w-full text-sm">
                    <tbody className="divide-y">
                        {entries.map(([key, value]) => (
                            <tr key={key} className="transition-colors">
                                <td className="px-4 py-2.5">
                                    <code className="font-mono font-semibold text-foreground text-[12px]">
                                        {key}
                                    </code>
                                </td>
                                <td
                                    className={cn(
                                        "px-4 py-2.5",
                                        !leftAlignValues && "text-right",
                                    )}
                                >
                                    {renderValue ? (
                                        renderValue(key, value)
                                    ) : isValidElement(value) ? (
                                        value
                                    ) : (
                                        <code className="text-xs font-mono text-muted-foreground">
                                            {typeof value === "string"
                                                ? value
                                                : String(value)}
                                        </code>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </SectionCard>
    );
}
