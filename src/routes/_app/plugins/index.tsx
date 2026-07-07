import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { pluginsApi } from "@/lib/api"
import type { Engine, Resolver } from "@/lib/schemas"
import { SchemaTable, CopyButton } from "@/components/schema-viewer"
import { JsonModal } from "@/components/json-modal"
import { SectionCard } from "@/components/section-card"
import { Button } from "@/components/ui/button"
import { Cpu, Zap, Code2, ChevronDown, ChevronRight, Braces } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { SidebarLayout, SidebarEntry, EmptyDetail, SidebarGroupContainer } from "@/components/resource-layout"
import { ResizableSidebar } from "@/components/resizable-sidebar"
import { MetadataBar, MetadataItem, MetadataSeparator } from "@/components/metadata-bar"


export const Route = createFileRoute("/_app/plugins/")({
  component: PluginsPage,
})

function PluginsPage() {
  const [tab, setTab] = useState<"engines" | "resolvers">("engines")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: engines = [], isLoading: enginesLoading } = useQuery({
    queryKey: ["engines"],
    queryFn: () => pluginsApi.engines(),
  })
  const { data: resolvers = [], isLoading: resolversLoading } = useQuery({
    queryKey: ["resolvers"],
    queryFn: () => pluginsApi.resolvers(),
  })

  const items = tab === "engines" ? engines : resolvers
  const selected = items.find((i) => i.id === selectedId)
  const loading = tab === "engines" ? enginesLoading : resolversLoading

  const switchTab = (t: "engines" | "resolvers") => { setTab(t); setSelectedId(null) }

  return (
    <ResizableSidebar defaultWidth={220} min={150} max={400}>
      <SidebarLayout
        title="Plugins"
        count={items.length}
        countLabel={tab}
        subtitle="Browse installed engines and resolvers"
        isLoading={loading}
        emptyText={`No ${tab}`}
        headerExtra={
          <div className="flex shrink-0 mx-1.5 border-b">
            <TabBtn active={tab === "engines"} onClick={() => switchTab("engines")}>
              <Cpu className="size-3" />Engines
              <span className="text-2xs text-muted-foreground tabular-nums">({engines.length})</span>
            </TabBtn>
            <TabBtn active={tab === "resolvers"} onClick={() => switchTab("resolvers")}>
              <Zap className="size-3" />Resolvers
              <span className="text-2xs text-muted-foreground tabular-nums">({resolvers.length})</span>
            </TabBtn>
          </div>
        }
        className="bg-card border rounded-xl h-full"
      >
        <SidebarGroupContainer>
        {items.map((item) => (
          <SidebarEntry
            key={item.id}
            selected={selectedId === item.id}
            onClick={() => setSelectedId(item.id)}
          >
            <div className="text-[13px] font-medium truncate">{item.name}</div>
            <div className="text-2xs text-muted-foreground/50 mt-0.5 line-clamp-2 leading-relaxed">
              {item.description || item.origin}
            </div>
          </SidebarEntry>
        ))}
        </SidebarGroupContainer>
      </SidebarLayout>
      {!selected ? (
        <EmptyDetail icon={Code2} text={`Select a ${tab === "engines" ? "engine" : "resolver"}`} />
      ) : (
        <DetailContent item={selected} tab={tab} />
      )}
    </ResizableSidebar>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className={cn(
        "flex-1 flex items-center justify-center gap-1 px-1 py-2 text-[12px] font-medium border-b-2 -mb-px transition-colors",
        active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// ── Detail content ───────────────────────────────────────────────────

function DetailContent({ item, tab }: { item: Engine | Resolver; tab: "engines" | "resolvers" }) {
  const hasRetryModes = tab === "engines" && item.retry_modes_schema && Object.keys(item.retry_modes_schema).length > 0

  return (
    <div className="p-5 space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-base font-bold">{item.name}</h2>
        {item.description && (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.description}</p>
        )}
      </div>

      {/* Metadata card */}
      <MetadataBar>
        <MetadataItem label="ID">
          <code className="text-foreground tabular-nums">{item.id}</code>
        </MetadataItem>
        <MetadataSeparator />
        <MetadataItem label="Origin">
          <code className="text-foreground">{item.origin}</code>
        </MetadataItem>
        <MetadataSeparator />
        <MetadataItem label="Hash" className="min-w-0">
          <code className="text-foreground/70 truncate shrink-0">{item.origin_hash}</code>
          <CopyButton text={item.origin_hash ?? ""} />
        </MetadataItem>
        {tab === "engines" && item.capabilities && (
          <>
            <MetadataSeparator />
            {Object.entries(item.capabilities).map(([cap, val]) => (
              <span key={cap} className="inline-flex items-center gap-1.5">
                <div className={cn("size-1.5 rounded-full", val ? "bg-emerald-500" : "bg-muted-trace")} />
                <span>{cap.replace(/^can_/, "")}</span>
              </span>
            ))}
          </>
        )}
      </MetadataBar>

      {/* Retry Modes */}
      {hasRetryModes && (
        <RetryModesBlock modes={item.retry_modes_schema} />
      )}

      {/* Config Schema */}
      {tab === "resolvers" && item.config_schema && Object.keys(item.config_schema).length > 0 && (
        <ConfigSchemaBlock schema={item.config_schema} />
      )}
    </div>
  )
}

// ── Config Schema block (with raw JSON button) ───────────────────────

function ConfigSchemaBlock({ schema }: { schema: Record<string, any> }) {
  return (
    <SectionCard
      title="Configuration"
      actions={
        <JsonModal
          title="Configuration"
          data={schema}
          trigger={(onClick) => (
            <Button variant="ghost" size="xs" onClick={onClick}>
              <Braces className="size-3" />
              Raw JSON
            </Button>
          )}
        />
      }
    >
      <div className="p-3">
        <SchemaTable schema={schema} />
      </div>
    </SectionCard>
  )
}

// ── Retry Modes block (with raw JSON button in header) ───────────────

function RetryModesBlock({ modes }: { modes: Record<string, any> }) {
  return (
    <SectionCard
      title="Retry Modes"
      actions={
        <JsonModal
          title="Retry Modes"
          data={modes}
          trigger={(onClick) => (
            <Button variant="ghost" size="xs" onClick={onClick}>
              <Braces className="size-3" />
              Raw JSON
            </Button>
          )}
        />
      }
    >
      <div className="divide-y">
        {Object.entries(modes).map(([mode, modeData]) => (
          <RetryModeRow key={mode} mode={mode} data={modeData} />
        ))}
      </div>
    </SectionCard>
  )
}

// ── Retry mode row ───────────────────────────────────────────────────

function RetryModeRow({ mode, data }: { mode: string; data: { schema?: { properties?: Record<string, unknown>; required?: string[] }; default_params?: Record<string, unknown> } }) {
  const [expanded, setExpanded] = useState(false)
  const hasSchema = data.schema?.properties && Object.keys(data.schema.properties).length > 0
  const hasDefaults = data.default_params && Object.keys(data.default_params).length > 0

  return (
    <div>
      <Button
        variant="ghost"
        className={cn(
          "w-full justify-start gap-2.5 px-4 py-3 h-auto text-xs",
          !expanded && (hasSchema || hasDefaults) ? "hover:bg-muted/30 cursor-pointer" : expanded ? "cursor-pointer" : "cursor-default"
        )}
        onClick={() => (hasSchema || hasDefaults) && setExpanded(!expanded)}
      >
        <code className="font-mono font-semibold bg-muted px-2 py-0.5 rounded text-xs">{mode}</code>
        {hasDefaults && !expanded && (
          <span className="text-xs text-muted-foreground font-mono truncate">{JSON.stringify(data.default_params)}</span>
        )}
        {!hasSchema && !hasDefaults && (
          <span className="text-xs text-muted-foreground/40 italic ml-auto">none</span>
        )}
        {(hasSchema || hasDefaults) && (
          <span className="ml-auto shrink-0">
            {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          </span>
        )}
      </Button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {hasDefaults && (
            <pre className="text-xs font-mono text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              {JSON.stringify(data.default_params, null, 2)}
            </pre>
          )}
          {hasSchema && (
            <SchemaTable schema={data.schema.properties} requiredFields={data.schema.required} />
          )}
        </div>
      )}
    </div>
  )
}
