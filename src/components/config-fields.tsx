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
} from "@/components/ui/select"
import { FormField } from "@/components/form-field"
import { DynamicForm } from "@/components/dynamic-form"

export interface PluginConfigFieldsProps {
  engineId: string
  resolverId: string
  retryMode: string
  retryConfig: Record<string, unknown>
  resolverConfig: Record<string, unknown>
  availableRetryModes: string[]
  retryModeSchema: any
  resolverConfigSchema: any
  engines: any[]
  resolvers: any[]
  onEngineChange: (v: string) => void
  onResolverChange: (v: string) => void
  onRetryModeChange: (v: string) => void
  onRetryConfigChange: (v: Record<string, unknown>) => void
  onResolverConfigChange: (v: Record<string, unknown>) => void
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
      <div className="grid grid-cols-2 gap-3 items-end">
        <div className="grid grid-cols-2 gap-2">
          <FormField label="Engine">
            <Select
              value={engineId}
              onValueChange={onEngineChange}
              items={engines.map((e: any) => ({ value: String(e.id), label: e.name }))}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="Select" />
              </SelectTrigger>
              <SelectContent>
                {engines.map((e: any) => (
                  <SelectItem key={e.id} value={String(e.id)}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Retry Mode">
            <Select
              value={retryMode}
              onValueChange={onRetryModeChange}
              disabled={!engineId}
              items={availableRetryModes.map((m: string) => ({ value: m, label: m }))}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder={engineId ? "Select" : "—"} />
              </SelectTrigger>
              <SelectContent>
                {availableRetryModes.map((m: string) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
        </div>
        <FormField label="Resolver">
          <Select
            value={resolverId}
            onValueChange={onResolverChange}
            items={resolvers.map((r: any) => ({ value: String(r.id), label: r.name }))}
          >
            <SelectTrigger className="h-8 text-xs w-full">
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              {resolvers.map((r: any) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {retryModeSchema && (
          <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Retry Config</p>
            <DynamicForm schema={retryModeSchema} value={retryConfig} onChange={onRetryConfigChange} />
          </div>
        )}
        {resolverConfigSchema && (
          <div className="rounded-lg border bg-muted/10 p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">Resolver Config</p>
            <DynamicForm schema={resolverConfigSchema} value={resolverConfig} onChange={onResolverConfigChange} />
          </div>
        )}
      </div>
    </>
  )
}
