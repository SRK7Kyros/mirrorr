/**
 * Reusable "Save as Profile" button with inline input.
 * Used in sessions/detail and autoruns/detail headers.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Bookmark } from "lucide-react";

interface SaveAsProfileButtonProps {
    open: boolean;
    onOpen: () => void;
    name: string;
    onNameChange: (name: string) => void;
    onSave: () => void;
    onCancel: () => void;
    isPending: boolean;
}

export function SaveAsProfileButton({
    open,
    onOpen,
    name,
    onNameChange,
    onSave,
    onCancel,
    isPending,
}: SaveAsProfileButtonProps) {
    if (!open) {
        return (
            <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={onOpen}
            >
                <Bookmark className="size-3 mr-1" />
                Save as Profile
            </Button>
        );
    }

    return (
        <div className="flex items-center gap-1.5">
            <Input
                value={name}
                onChange={(e) => onNameChange(e.target.value)}
                className="h-7 text-[11px] w-36"
                placeholder="Profile name"
                autoFocus
                onKeyDown={(e) => {
                    if (e.key === "Enter" && name.trim()) onSave();
                    else if (e.key === "Escape") onCancel();
                }}
            />
            <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                disabled={!name.trim() || isPending}
                onClick={onSave}
            >
                {isPending ? (
                    <Loader2 className="size-3 mr-1 animate-spin" />
                ) : (
                    <Bookmark className="size-3 mr-1" />
                )}
                Save
            </Button>
            <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={onCancel}
            >
                Cancel
            </Button>
        </div>
    );
}
