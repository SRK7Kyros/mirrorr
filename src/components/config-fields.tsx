/**
 * Shared plugin configuration fields (engine, resolver, retry mode, dynamic forms).
 * Replaces the duplicated ConfigFields / AutorunConfigFields in sessions and autoruns.
 */
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { FormField } from "@/components/form-field";
import { DynamicForm } from "@/components/dynamic-form";
import { AREAS, CONFIG_SELECTORS, CONFIG_PANELS } from "@/lib/layouts";
import { ConfigPanel } from "@/components/config-panel";

export interface PluginConfigFieldsProps {
    engineId: string;
    resolverId: string;
    retryMode: string;
    retryConfig: Record<string, unknown>;
    resolverConfig: Record<string, unknown>;
    availableRetryModes: string[];
    retryModeSchema: any;
    resolverConfigSchema: any;
    engines: any[];
    resolvers: any[];
    onEngineChange: (v: string) => void;
    onResolverChange: (v: string) => void;
    onRetryModeChange: (v: string) => void;
    onRetryConfigChange: (v: Record<string, unknown>) => void;
    onResolverConfigChange: (v: Record<string, unknown>) => void;
}

export function PluginConfigFields({
    engineId,
    resolverId,
    retryMode,
    retryConfig,
    resolverConfig,
    availableRetryModes,
    retryModeSchema,
    resolverConfigSchema,
    engines,
    resolvers,
    onEngineChange,
    onResolverChange,
    onRetryModeChange,
    onRetryConfigChange,
    onResolverConfigChange,
}: PluginConfigFieldsProps) {
    return (
        <>
            <div className="grid gap-3 items-end" style={CONFIG_SELECTORS.style}>
                <div className="grid gap-2" style={{ gridArea: AREAS.selects }}>
                    <FormField label="Engine">
                        <Select
                            value={engineId}
                            onValueChange={onEngineChange}
                            items={engines.map((e: any) => ({
                                value: String(e.id),
                                label: e.name,
                            }))}
                        >
                            <SelectTrigger className="h-8 text-xs w-full">
                                <SelectValue placeholder="Select" />
                            </SelectTrigger>
                            <SelectContent>
                                {engines.map((e: any) => (
                                    <SelectItem key={e.id} value={String(e.id)}>
                                        {e.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                    <FormField label="Retry Mode">
                        <Select
                            value={retryMode}
                            onValueChange={onRetryModeChange}
                            disabled={!engineId}
                            items={availableRetryModes.map((m: string) => ({
                                value: m,
                                label: m,
                            }))}
                        >
                            <SelectTrigger className="h-8 text-xs w-full">
                                <SelectValue
                                    placeholder={engineId ? "Select" : "—"}
                                />
                            </SelectTrigger>
                            <SelectContent>
                                {availableRetryModes.map((m: string) => (
                                    <SelectItem key={m} value={m}>
                                        {m}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </FormField>
                </div>
                <div style={{ gridArea: AREAS.resolver }}>
                <FormField label="Resolver">
                    <Select
                        value={resolverId}
                        onValueChange={onResolverChange}
                        items={resolvers.map((r: any) => ({
                            value: String(r.id),
                            label: r.name,
                        }))}
                    >
                        <SelectTrigger className="h-8 text-xs w-full">
                            <SelectValue placeholder="Select" />
                        </SelectTrigger>
                        <SelectContent>
                            {resolvers.map((r: any) => (
                                <SelectItem key={r.id} value={String(r.id)}>
                                    {r.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </FormField>
                </div>
            </div>
            <div className="grid gap-3" style={CONFIG_PANELS.style}>
                {retryModeSchema && (
                    <ConfigPanel title="Retry Config" style={{ gridArea: AREAS["retry-config"] }}>
                        <DynamicForm
                            schema={retryModeSchema}
                            value={retryConfig}
                            onChange={onRetryConfigChange}
                        />
                    </ConfigPanel>
                )}
                {resolverConfigSchema && (
                    <ConfigPanel title="Resolver Config" style={{ gridArea: AREAS["resolver-config"] }}>
                        <DynamicForm
                            schema={resolverConfigSchema}
                            value={resolverConfig}
                            onChange={onResolverConfigChange}
                        />
                    </ConfigPanel>
                )}
            </div>
        </>
    );
}
