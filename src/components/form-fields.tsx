/**
 * Reusable form field components for config panels.
 */
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// ── Engine override selector ───────────────────────────────────

interface EngineOverrideProps {
    engines: any[];
    value: string;
    onChange: (v: string) => void;
    selectedProfile?: any;
    disabled?: boolean;
}

export function EngineOverrideSelector({
    engines,
    value,
    onChange,
    selectedProfile,
    disabled,
}: EngineOverrideProps) {
    return (
        <div className="space-y-1.5">
            <Label className="text-[11px]">Engine Override</Label>
            <Select
                value={value}
                onValueChange={onChange}
                items={engines.map((e: any) => ({
                    value: String(e.id),
                    label: `${e.name}${selectedProfile && e.id === selectedProfile.default_engine_id ? " (Default)" : ""}`,
                }))}
                disabled={disabled}
            >
                <SelectTrigger className="h-8 text-xs w-full">
                    <SelectValue placeholder="Override engine" />
                </SelectTrigger>
                <SelectContent>
                    {engines.map((e: any) => (
                        <SelectItem key={e.id} value={String(e.id)}>
                            {e.name}
                            {selectedProfile &&
                            e.id === selectedProfile.default_engine_id
                                ? " (Default)"
                                : ""}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

// ── Recording toggle ───────────────────────────────────────────

interface RecordingToggleProps {
    checked: boolean;
    onChange: (v: boolean) => void;
}

export function RecordingToggle({ checked, onChange }: RecordingToggleProps) {
    return (
        <div className="flex items-center justify-between">
            <Label className="text-[11px]">Recording</Label>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    );
}

// ── Labeled field row ──────────────────────────────────────────

interface LabeledFieldProps {
    label: string;
    children: React.ReactNode;
}

export function LabeledField({ label, children }: LabeledFieldProps) {
    return (
        <div className="space-y-1.5">
            <Label className="text-[11px]">{label}</Label>
            {children}
        </div>
    );
}
