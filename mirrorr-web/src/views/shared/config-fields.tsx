import { useMemo } from "react"
import { Fieldset } from "@/components/ui/FormField"
import { Select } from "@/components/ui/Select"
import { Switch } from "@/components/ui/Switch"
import {
  DynamicSchemaForm,
  prefillSchemaValues,
  type SchemaValues,
} from "@/components/ui/dynamic-schema-form"
import type { Engine, Resolver } from "@/lib/schemas"

export interface ConfigFieldsValue {
  readonly engineId: number | null
  readonly resolverId: number | null
  readonly resolverConfig: SchemaValues
  readonly retryMode: string | null
  readonly retryConfig: SchemaValues
  readonly recording: boolean
}

export interface ConfigFieldsProps {
  readonly value: ConfigFieldsValue
  readonly onChange: (next: Partial<ConfigFieldsValue>) => void
  readonly engines: readonly Engine[]
  readonly resolvers: readonly Resolver[]
  readonly errors?: Readonly<Record<string, string>>
  readonly disabled?: boolean
  readonly showRecording?: boolean
}

export function resolverSchemaOf(
  resolvers: readonly Resolver[],
  resolverId: number | null,
): Record<string, unknown> | undefined {
  return resolvers.find((entry) => entry.id === resolverId)?.config_schema
}

export function retrySchemaOf(
  engine: Engine | undefined,
  retryMode: string | null,
): { schema: Record<string, unknown> | undefined; defaultParams: Record<string, unknown> } {
  if (engine === undefined || retryMode == null) return { schema: undefined, defaultParams: {} }
  const entry = (engine.retry_modes_schema as Record<string, unknown> | undefined)?.[retryMode]
  if (entry === undefined || entry === null || typeof entry !== "object") {
    return { schema: undefined, defaultParams: {} }
  }
  const typed = entry as { schema?: Record<string, unknown>; default_params?: Record<string, unknown> }
  return { schema: typed.schema ?? {}, defaultParams: typed.default_params ?? {} }
}

export function canRecordFlag(engine: Engine | undefined): boolean {
  return engine?.capabilities?.can_record !== false
}

function hasSchemaFields(schema: Record<string, unknown> | undefined): boolean {
  const props = schema?.properties
  return typeof props === "object" && props !== null && Object.keys(props).length > 0
}

/** Engine / resolver / DynamicSchemaForm / retry / recording widget set (D1 + D2). */
export function ConfigFields({
  value,
  onChange,
  engines,
  resolvers,
  errors,
  disabled = false,
  showRecording = true,
}: ConfigFieldsProps) {
  const engine = useMemo(() => engines.find((entry) => entry.id === value.engineId), [engines, value.engineId])
  const resolverSchema = resolverSchemaOf(resolvers, value.resolverId)
  const retry = retrySchemaOf(engine, value.retryMode)
  const canRecord = canRecordFlag(engine)

  const engineOptions = engines.map((entry) => ({ value: String(entry.id), label: entry.name }))
  const resolverOptions = resolvers.map((entry) => ({ value: String(entry.id), label: entry.name }))
  const retryModeOptions = Object.keys(engine?.retry_modes_schema ?? {}).map((mode) => ({
    value: mode,
    label: mode,
  }))

  return (
    <>
      <Select
        label="Engine"
        options={engineOptions}
        value={value.engineId == null ? null : String(value.engineId)}
        disabled={disabled}
        error={errors?.engine_id}
        required
        onChange={(next) => {
          const nextId = Number(next)
          const nextEngine = engines.find((entry) => entry.id === nextId)
          onChange({
            engineId: nextId,
            retryMode: null,
            retryConfig: prefillSchemaValues(undefined, undefined),
          })
          void nextEngine
        }}
      />
      <Select
        label="Resolver"
        options={resolverOptions}
        value={value.resolverId == null ? null : String(value.resolverId)}
        disabled={disabled}
        error={errors?.resolver_id}
        required
        onChange={(next) => {
          const nextId = Number(next)
          const nextSchema = resolverSchemaOf(resolvers, nextId)
          onChange({ resolverId: nextId, resolverConfig: prefillSchemaValues(nextSchema, undefined) })
        }}
      />
      {hasSchemaFields(resolverSchema) ? (
        <DynamicSchemaForm
          legend="Resolver config"
          schema={resolverSchema}
          value={value.resolverConfig}
          onChange={(next) => onChange({ resolverConfig: next })}
          path="cfg-resolver"
          errors={errors}
          disabled={disabled}
        />
      ) : null}
      {retryModeOptions.length > 0 ? (
        <Select
          label="Retry mode"
          options={retryModeOptions}
          value={value.retryMode}
          disabled={disabled}
          error={errors?.retry_mode}
          onChange={(next) => {
            const { defaultParams } = retrySchemaOf(engine, next)
            onChange({
              retryMode: next,
              retryConfig: prefillSchemaValues({ default_params: defaultParams }, undefined),
            })
          }}
        />
      ) : null}
      {hasSchemaFields(retry.schema) ? (
        <Fieldset legend="Retry config">
          <DynamicSchemaForm
            schema={retry.schema}
            value={value.retryConfig}
            onChange={(next) => onChange({ retryConfig: next })}
            path="cfg-retry"
            errors={errors}
            disabled={disabled}
          />
        </Fieldset>
      ) : null}
      {showRecording ? (
        <Switch
          label="Record to file"
          showLabel
          checked={value.recording}
          disabled={disabled || !canRecord}
          disabledReason={canRecord ? undefined : "Engine cannot record"}
          onChange={(next) => onChange({ recording: next })}
        />
      ) : null}
    </>
  )
}
