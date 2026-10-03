import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Skeleton } from "@/components/ui/Skeleton"
import { LOOKUP_PAGE_SIZE, queryKeys, staleTimes } from "@/lib/query-keys"
import type { Engine, Resolver } from "@/lib/schemas"
import { fetchAllEngines, fetchAllResolvers } from "@/views/shared/api"
import "@/styles/views-admin.css"

/**
 * §5.9 Plugins (Engines & Resolvers) — read-only introspection of `GET
 * /engines/` + `GET /resolvers/` (LOOKUP_PAGE_SIZE crawl). No writes exist;
 * the loudest control is "Copy hash". Engines carry `retry_modes_schema`, so
 * their panel runs wider than the resolver panel.
 */

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Secure-context clipboard API unavailable — transient textarea fallback.
  }
  try {
    const area = document.createElement("textarea")
    area.value = text
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand("copy")
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Opaque label-caps mono hash chip; truncated to 12 chars, flips to "Copied". */
function HashChip({ hash, kind }: { hash: string; kind: string }) {
  const [copied, setCopied] = useState(false)
  const short = hash.length > 12 ? `${hash.slice(0, 12)}…` : hash

  return (
    <span className="code-chip">
      <span className="code-chip__value" title={hash}>
        {short}
      </span>
      <button
        type="button"
        className="code-copy"
        aria-label={`Copy ${kind} hash`}
        onClick={() => {
          void copyText(hash).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? "Copied" : "Copy hash"}
      </button>
    </span>
  )
}

/** Schema blocks collapse behind "Show schema" (§5.9 dense). */
function SchemaBlock({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="adm-stack">
      <Button variant="secondary" onClick={() => setOpen((current) => !current)}>
        {open ? `Hide ${label}` : `Show ${label}`}
      </Button>
      {open ? <pre className="adm-mono-block t-mono">{JSON.stringify(value ?? {}, null, 2)}</pre> : null}
    </div>
  )
}

function CapabilityBadges({ capabilities }: { capabilities: Record<string, unknown> | undefined }) {
  const canRecord = capabilities?.can_record === true
  const canPlaylist = capabilities?.can_playlist === true
  return (
    <span className="plugin-badges">
      <Badge variant={canRecord ? "capability-true" : "capability"}>{canRecord ? "can record" : "no record"}</Badge>
      <Badge variant={canPlaylist ? "capability-true" : "capability"}>
        {canPlaylist ? "can playlist" : "no playlist"}
      </Badge>
    </span>
  )
}

function EngineEntry({ engine }: { engine: Engine }) {
  return (
    <article className="plugin-entry">
      <div className="plugin-entry__title">
        <h3 className="t-h3">{engine.name}</h3>
        <span className="t-label-caps adm-muted">engine</span>
      </div>
      {engine.description != null && engine.description !== "" ? (
        <p className="t-body plugin-entry__desc">{engine.description}</p>
      ) : null}
      <div className="adm-row">
        <HashChip hash={engine.origin_hash} kind="engine" />
        <CapabilityBadges capabilities={engine.capabilities} />
      </div>
      <p className="t-mono plugin-origin adm-muted">{engine.origin}</p>
      <SchemaBlock label="schema" value={engine.retry_modes_schema ?? {}} />
    </article>
  )
}

function ResolverEntry({ resolver }: { resolver: Resolver }) {
  return (
    <article className="plugin-entry">
      <div className="plugin-entry__title">
        <h3 className="t-h3">{resolver.name}</h3>
        <span className="t-label-caps adm-muted">resolver</span>
      </div>
      {resolver.description != null && resolver.description !== "" ? (
        <p className="t-body plugin-entry__desc">{resolver.description}</p>
      ) : null}
      <div className="adm-row">
        <HashChip hash={resolver.origin_hash} kind="resolver" />
      </div>
      <p className="t-mono plugin-origin adm-muted">{resolver.origin}</p>
      <SchemaBlock label="config schema" value={resolver.config_schema ?? {}} />
    </article>
  )
}

export function PluginsView() {
  const enginesQuery = useQuery({
    queryKey: queryKeys.engines,
    queryFn: () => fetchAllEngines(LOOKUP_PAGE_SIZE),
    staleTime: staleTimes.lookup,
  })
  const resolversQuery = useQuery({
    queryKey: queryKeys.resolvers,
    queryFn: () => fetchAllResolvers(LOOKUP_PAGE_SIZE),
    staleTime: staleTimes.lookup,
  })

  const engines = enginesQuery.data ?? []
  const resolvers = resolversQuery.data ?? []
  const loading = enginesQuery.isLoading || resolversQuery.isLoading
  const isError = enginesQuery.isError || resolversQuery.isError
  const isEmpty = !loading && !isError && engines.length === 0 && resolvers.length === 0

  const retry = (): void => {
    void enginesQuery.refetch()
    void resolversQuery.refetch()
  }

  return (
    <div className="adm-page">
      <header className="adm-head">
        <h1 className="t-h2">Plugins</h1>
        <p className="t-body adm-head__note adm-measure">
          Engines and resolvers are discovered from disk at server boot — read-only.
        </p>
      </header>

      {isError ? (
        <ErrorPanel
          title="Cannot load plugins"
          body="The plugin registry could not be read."
          actions={
            <Button variant="secondary" onClick={retry}>
              Retry
            </Button>
          }
        />
      ) : loading ? (
        <div className="adm-grid adm-grid--plugins" aria-busy="true" aria-label="Loading plugins">
          <section className="adm-panel panel opaque">
            <Skeleton geometry="row" />
            <Skeleton geometry="row" />
            <Skeleton geometry="row" />
          </section>
          <section className="adm-panel panel opaque">
            <Skeleton geometry="row" />
            <Skeleton geometry="row" />
          </section>
        </div>
      ) : isEmpty ? (
        <div className="panel opaque adm-panel">
          <EmptyState
            headline="No plugins discovered on this install."
            body="Mirrorr discovers engines and resolvers from disk at boot."
          />
        </div>
      ) : (
        <div className="adm-grid adm-grid--plugins">
          <section className="adm-panel panel opaque" aria-label="Engines">
            <div className="adm-panel__head">
              <h2 className="t-h3">Engines</h2>
              <span className="t-body adm-muted">{engines.length}</span>
            </div>
            {engines.length === 0 ? (
              <p className="t-body adm-muted">No engines discovered.</p>
            ) : (
              engines.map((engine) => <EngineEntry key={engine.id} engine={engine} />)
            )}
          </section>
          <section className="adm-panel panel opaque" aria-label="Resolvers">
            <div className="adm-panel__head">
              <h2 className="t-h3">Resolvers</h2>
              <span className="t-body adm-muted">{resolvers.length}</span>
            </div>
            {resolvers.length === 0 ? (
              <p className="t-body adm-muted">No resolvers discovered.</p>
            ) : (
              resolvers.map((resolver) => <ResolverEntry key={resolver.id} resolver={resolver} />)
            )}
          </section>
        </div>
      )}
    </div>
  )
}
