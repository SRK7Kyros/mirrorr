import { useState } from "react"
import { Badge } from "@/components/ui/Badge"
import { EmptyState } from "@/components/ui/EmptyState"
import type { Engine, Resolver } from "@/lib/schemas"
import { useEngines, useResolvers } from "@/views/shared/hooks"
import { CopyButton, JsonWell } from "@/views/shared/parts"

function CapabilityBadges({ capabilities }: { capabilities: Record<string, unknown> | undefined }) {
  const canRecord = capabilities?.can_record === true
  const canPlaylist = capabilities?.can_playlist === true
  return (
    <span className="cluster">
      <Badge variant={canRecord ? "capability-true" : "capability"}>{canRecord ? "records" : "no record"}</Badge>
      <Badge variant={canPlaylist ? "capability-true" : "capability"}>
        {canPlaylist ? "playlists" : "no playlist"}
      </Badge>
    </span>
  )
}

function HashLine({ hash, kind }: { hash: string; kind: string }) {
  return (
    <span className="cluster">
      <span className="t-mono-inline" title={hash}>
        {hash.length > 12 ? `${hash.slice(0, 12)}…` : hash}
      </span>
      <CopyButton text={hash} label={`Copy ${kind} hash`} />
    </span>
  )
}

function EngineCard({ engine }: { engine: Engine }) {
  const [open, setOpen] = useState(false)
  const retryModes = Object.entries(engine.retry_modes_schema ?? {})
  return (
    <article className="card card-stack">
      <h2 className="card__title">{engine.name}</h2>
      {engine.description != null && engine.description !== "" ? (
        <p className="t-body view-subtitle">{engine.description}</p>
      ) : null}
      <HashLine hash={engine.origin_hash} kind="engine" />
      <p className="t-mono wrap-anywhere">{engine.origin}</p>
      <CapabilityBadges capabilities={engine.capabilities} />
      {retryModes.length > 0 ? (
        <>
          <button type="button" className="schema-group__toggle" onClick={() => setOpen((value) => !value)}>
            Retry modes ({retryModes.length})
          </button>
          {open ? (
            <div className="schema-group">
              {retryModes.map(([mode, entry]) => (
                <div key={mode} className="card-stack">
                  <Badge variant="tag">{mode}</Badge>
                  <JsonWell value={entry} />
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  )
}

function ResolverCard({ resolver }: { resolver: Resolver }) {
  const [open, setOpen] = useState(false)
  return (
    <article className="card card-stack">
      <h2 className="card__title">{resolver.name}</h2>
      {resolver.description != null && resolver.description !== "" ? (
        <p className="t-body view-subtitle">{resolver.description}</p>
      ) : null}
      <HashLine hash={resolver.origin_hash} kind="resolver" />
      <p className="t-mono wrap-anywhere">{resolver.origin}</p>
      <button type="button" className="schema-group__toggle" onClick={() => setOpen((value) => !value)}>
        Config schema
      </button>
      {open ? (
        <div className="schema-group">
          <JsonWell value={resolver.config_schema ?? {}} />
        </div>
      ) : null}
    </article>
  )
}

/** V9 — Plugins (engines + resolvers read-only cards + schema viewers). */
export function PluginsView() {
  const engines = useEngines()
  const resolvers = useResolvers()

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Plugins</h1>
        <span className="view-footnote">Plugins are discovered at server boot</span>
      </div>

      <section className="card-stack">
        <h2 className="card__legend">Engines</h2>
        {engines.length === 0 ? (
          <EmptyState headline="No engines installed" body="No engines installed" />
        ) : (
          <div className="card-grid card-grid--plugins">
            {engines.map((engine) => (
              <EngineCard key={engine.id} engine={engine} />
            ))}
          </div>
        )}
      </section>

      <section className="card-stack">
        <h2 className="card__legend">Resolvers</h2>
        {resolvers.length === 0 ? (
          <EmptyState headline="No resolvers installed" body="No resolvers installed" />
        ) : (
          <div className="card-grid card-grid--plugins">
            {resolvers.map((resolver) => (
              <ResolverCard key={resolver.id} resolver={resolver} />
            ))}
          </div>
        )}
      </section>

      <p className="view-footnote">Read-only — manage plugins on the server filesystem.</p>
    </div>
  )
}
