import { createFileRoute } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { pluginsApi } from "@/lib/api"
import { ScrollArea } from "@/components/ui/scroll-area"
import { SchemaTable, CopyButton } from "@/components/schema-viewer"
import { Cpu, Zap, Code2, ChevronDown, ChevronRight, Braces } from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"

export const Route = createFileRoute("/_app/plugins/")({
  component: PluginsPage,
})

function PluginsPage() {
  const [tab, setTab] = useState<"engines" | "resolvers">("engines")
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const { data: engines = [], isLoading: enginesLoading } = useQuery({
    queryKey: ["engines"],
    queryFn: () => pluginsApi.engines() as Promise<any[]>,
  })
  const { data: resolvers = [], isLoading: resolversLoading } = useQuery({
    queryKey: ["resolvers"],
    queryFn: () => pluginsApi.resolvers() as Promise<any[]>,
  })

  const items = tab === "engines" ? engines : resolvers
  const selected = items.find((i: any) => i.id === selectedId)
  const loading = tab === "engines" ? enginesLoading : resolversLoading

  const switchTab = (t: "engines" | "resolvers") => { setTab(t); setSelectedId(null) }

  return (
    <div className="h-full grid grid-cols-[220px_1fr] gap-2 p-2">
      {/* Sidebar */}
      <div className="flex flex-col min-h-0 bg-card border rounded-xl overflow-hidden">
        <div className="shrink-0 px-3.5 pt-4 pb-3">
          <h1 className="text-lg font-bold tracking-tight">Plugins</h1>
          <p className="text-[11px] text-muted-foreground/60 mt-1 leading-relaxed">Browse installed engines and resolvers</p>
        </div>

        <div className="flex shrink-0 mx-1.5 border-b">
          <TabBtn active={tab === "engines"} onClick={() => switchTab("engines")}>
            <Cpu className="size-3" />Engines
            <span className="text-[10px] text-muted-foreground tabular-nums">({engines.length})</span>
          </TabBtn>
          <TabBtn active={tab === "resolvers"} onClick={() => switchTab("resolvers")}>
            <Zap className="size-3" />Resolvers
            <span className="text-[10px] text-muted-foreground tabular-nums">({resolvers.length})</span>
          </TabBtn>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-1.5 space-y-px">
            {loading ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">Loading...</div>
            ) : items.length === 0 ? (
              <div className="text-[11px] text-muted-foreground text-center py-6">No {tab}</div>
            ) : (
              items.map((item: any) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "w-full text-left px-2.5 py-2.5 rounded-md transition-colors",
                    selectedId === item.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  )}
                >
                  <div className="text-[13px] font-medium truncate">{item.name}</div>
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5 line-clamp-2 leading-relaxed">
                    {item.description || item.origin}
                  </div>
                </button>
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Detail */}
      <div className="min-h-0 overflow-auto bg-card border rounded-xl">
        {!selected ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Code2 className="size-8 mb-2 opacity-15" />
            <p className="text-xs">Select a {tab === "engines" ? "engine" : "resolver"}</p>
          </div>
        ) : (
          <DetailContent item={selected} tab={tab} />
        )}
      </div>
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-1 px-1 py-2 text-[12px] font-medium transition-colors border-b-2 -mb-px",
        active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

// ── Detail content ───────────────────────────────────────────────────

function DetailContent({ item, tab }: { item: any; tab: "engines" | "resolvers" }) {
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
      <div className="rounded-lg border bg-muted/20 px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">ID</span>
          <code className="text-foreground tabular-nums">{item.id}</code>
        </span>
        <span className="text-border">·</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground/60 text-[10px] uppercase tracking-wider">Origin</span>
          <code className="text-foreground">{item.origin}</code>
        </span>
        <span className="text-border">·</span>
        <span className="inline-flex items-center gap-1.5 min-w-0">
          <span className="text-muted-foreground/60 text-[10px] uppercase tracking-wider shrink-0">Hash</span>
          <code className="text-foreground/70 truncate">{item.origin_hash}</code>
          <CopyButton text={item.origin_hash ?? ""} />
        </span>
        {tab === "engines" && item.capabilities && (
          <>
            <span className="text-border">·</span>
            {Object.entries(item.capabilities).map(([cap, val]) => (
              <span key={cap} className="inline-flex items-center gap-1.5">
                <div className={cn("size-1.5 rounded-full", val ? "bg-emerald-500" : "bg-muted-foreground/30")} />
                <span>{cap.replace(/^can_/, "")}</span>
              </span>
            ))}
          </>
        )}
      </div>

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
  const [jsonOpen, setJsonOpen] = useState(false)

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Configuration</h3>
          <button
            onClick={() => setJsonOpen(true)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Braces className="size-3" />
            Raw JSON
          </button>
        </div>
        <div className="p-3">
          <SchemaTable schema={schema} />
        </div>
      </div>

      {jsonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setJsonOpen(false)}>
          <div className="bg-card border rounded-lg shadow-xl w-[90vw] max-w-3xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
              <h3 className="text-xs font-semibold">Configuration — Raw JSON</h3>
              <div className="flex items-center gap-2">
                <CopyButton text={JSON.stringify(schema, null, 2)} />
                <button onClick={() => setJsonOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <pre className="p-4 text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre">
                {JSON.stringify(schema, null, 2)}
              </pre>
            </ScrollArea>
          </div>
        </div>
      )}
    </>
  )
}

// ── Retry Modes block (with raw JSON button in header) ───────────────

function RetryModesBlock({ modes }: { modes: Record<string, any> }) {
  const [jsonOpen, setJsonOpen] = useState(false)

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-muted/20 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Retry Modes</h3>
          <button
            onClick={() => setJsonOpen(true)}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <Braces className="size-3" />
            Raw JSON
          </button>
        </div>
        <div className="divide-y">
          {Object.entries(modes).map(([mode, modeData]) => (
            <RetryModeRow key={mode} mode={mode} data={modeData} />
          ))}
        </div>
      </div>

      {jsonOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setJsonOpen(false)}>
          <div className="bg-card border rounded-lg shadow-xl w-[90vw] max-w-3xl h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0">
              <h3 className="text-xs font-semibold">Retry Modes — Raw JSON</h3>
              <div className="flex items-center gap-2">
                <CopyButton text={JSON.stringify(modes, null, 2)} />
                <button onClick={() => setJsonOpen(false)} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <pre className="p-4 text-[11px] font-mono text-muted-foreground leading-relaxed whitespace-pre">
                {JSON.stringify(modes, null, 2)}
              </pre>
            </ScrollArea>
          </div>
        </div>
      )}
    </>
  )
}

// ── Retry mode row ───────────────────────────────────────────────────

function RetryModeRow({ mode, data }: { mode: string; data: any }) {
  const [expanded, setExpanded] = useState(false)
  const hasSchema = data.schema?.properties && Object.keys(data.schema.properties).length > 0
  const hasDefaults = data.default_params && Object.keys(data.default_params).length > 0

  return (
    <div>
      <button
        onClick={() => (hasSchema || hasDefaults) && setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2.5 px-4 py-3 text-xs text-left transition-colors",
          !expanded && (hasSchema || hasDefaults) ? "hover:bg-muted/30 cursor-pointer" : expanded ? "cursor-pointer" : "cursor-default"
        )}
      >
        <code className="font-mono font-semibold bg-muted px-2 py-0.5 rounded text-[11px]">{mode}</code>
        {hasDefaults && !expanded && (
          <span className="text-[11px] text-muted-foreground font-mono truncate">{JSON.stringify(data.default_params)}</span>
        )}
        {!hasSchema && !hasDefaults && (
          <span className="text-[11px] text-muted-foreground/40 italic ml-auto">none</span>
        )}
        {(hasSchema || hasDefaults) && (
          <span className="ml-auto shrink-0">
            {expanded ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevronRight className="size-3.5 text-muted-foreground" />}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          {hasDefaults && (
            <pre className="text-[11px] font-mono text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
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
