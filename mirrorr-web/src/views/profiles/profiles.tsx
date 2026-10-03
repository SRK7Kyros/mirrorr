import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Chip } from "@/components/ui/Chip"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { OverflowMenu } from "@/components/ui/OverflowMenu"
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/Table"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import { queryKeys, queryRoots, resolveEntityName } from "@/lib/query-keys"
import type { Autorun, Profile, Session } from "@/lib/schemas"
import { deleteProfile, downloadJson, fetchAutorunPage, fetchProfileExport, fetchProfilePage, fetchSessionPage } from "@/views/shared/api"
import { removeFromInfiniteLists, useEntityList, useHighlightRef, useNameMaps } from "@/views/shared/hooks"
import { EngineResolverPair } from "@/views/shared/parts"
import { ProfileEditorDialog } from "./profile-editor-dialog"
import { NewSessionDialog } from "@/views/sessions/new-session-dialog"
import "@/styles/views-entities.css"

function highlightParam(): number | null {
  if (typeof window === "undefined") return null
  const raw = new URLSearchParams(window.location.search).get("highlight")
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/** §5.8 — Profiles: engine + resolver + retry policy saved for reuse. */
export function ProfilesView() {
  const client = useQueryClient()
  const { toast } = useToast()
  const names = useNameMaps()
  const list = useEntityList<Profile>({
    queryKey: queryKeys.profiles({}),
    fetchPage: (cursor) => fetchProfilePage(cursor),
  })
  const highlight = useHighlightRef(highlightParam())

  // Reference counts are client-side (no server ref endpoint): scan both lists.
  const autoruns = useEntityList<Autorun>({
    queryKey: queryKeys.autoruns({ refs: true }),
    fetchPage: (cursor) => fetchAutorunPage(cursor),
  })
  const sessions = useEntityList<Session>({
    queryKey: queryKeys.sessions({ refs: true }),
    fetchPage: (cursor) => fetchSessionPage(cursor),
  })

  const refs = useMemo(() => {
    const map = new Map<number, { autoruns: number; sessions: number }>()
    for (const autorun of autoruns.items) {
      const id = autorun.profile_id
      if (id == null) continue
      const entry = map.get(id) ?? { autoruns: 0, sessions: 0 }
      entry.autoruns += 1
      map.set(id, entry)
    }
    for (const session of sessions.items) {
      const id = session.profile_id
      if (id == null) continue
      const entry = map.get(id) ?? { autoruns: 0, sessions: 0 }
      entry.sessions += 1
      map.set(id, entry)
    }
    return map
  }, [autoruns.items, sessions.items])

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [useTarget, setUseTarget] = useState<Profile | null>(null)

  const openCreate = () => {
    setEditing(null)
    setEditorOpen(true)
  }

  const doExport = async (profile: Profile) => {
    try {
      const bundle = await fetchProfileExport(profile.id)
      if (!downloadJson(`profile-${profile.name.replace(/[^a-zA-Z0-9_-]+/g, "_")}.json`, bundle)) {
        throw new Error("download failed")
      }
      toast({ kind: "success", title: "Profile exported" })
    } catch {
      toast({ kind: "error", title: "Export failed" })
    }
  }

  const doDelete = async (profile: Profile) => {
    setDeleteError(null)
    try {
      await deleteProfile(profile.id)
      removeFromInfiniteLists(client, queryRoots.profiles, profile.id)
      void client.invalidateQueries({ queryKey: queryRoots.profiles })
      toast({ kind: "success", title: "Profile deleted" })
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(
        error instanceof ApiError && error.status === 400
          ? error.message
          : "Could not delete this profile.",
      )
    }
  }

  const refsFor = (profile: Profile) => refs.get(profile.id) ?? { autoruns: 0, sessions: 0 }
  const inUse = (profile: Profile) => {
    const counts = refsFor(profile)
    return counts.autoruns + counts.sessions > 0
  }

  return (
    <div className="ve">
      <div className="ve-bar">
        <span className="ve-note">A profile saves engine, resolver and retry policy for reuse.</span>
        <div className="ve-bar__end">
          <Button variant="primary" onClick={openCreate}>
            New profile
          </Button>
        </div>
      </div>

      {list.isLoading ? (
        <div className="opaque ve-table-panel">
          <Table label="Profiles">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Engine → Resolver</TableCell>
                <TableCell>Retry</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell className="ve-c-refs">In use</TableCell>
                <TableCell className="ve-c-actions">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody loading columns={6} />
          </Table>
        </div>
      ) : list.isError ? (
        <ErrorPanel
          title="Could not load profiles"
          body={list.error instanceof Error ? list.error.message : "Unexpected server response."}
          actions={
            <Button variant="secondary" onClick={list.refetch}>
              Retry
            </Button>
          }
        />
      ) : list.items.length === 0 ? (
        <div className="opaque ve-panel">
          <EmptyState
            eyebrow="Profiles"
            headline="No profiles."
            body="A profile saves engine, resolver and retry policy for reuse."
            action={
              <Button variant="primary" onClick={openCreate}>
                New profile
              </Button>
            }
          />
        </div>
      ) : (
        <div className="opaque panel ve-table-panel">
          <Table label="Profiles" className="ve-table">
            <TableHead>
              <TableRow>
                <TableCell className="ve-c-name">Name</TableCell>
                <TableCell className="ve-c-pair">Engine → Resolver</TableCell>
                <TableCell className="ve-c-retry">Retry</TableCell>
                <TableCell>Owner</TableCell>
                <TableCell className="ve-c-refs">In use</TableCell>
                <TableCell className="ve-c-actions">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody columns={6}>
              {list.items.map((profile) => {
                const counts = refsFor(profile)
                const engineName = resolveEntityName(profile.engine_name, names.engines, profile.default_engine_id)
                const resolverName = resolveEntityName(profile.resolver_name, names.resolvers, profile.resolver_id)
                return (
                  <TableRow key={profile.id}>
                    <TableCell className="ve-c-name">
                      <span ref={highlight} data-id={profile.id} />
                      <span className="ve-title-cell">
                        <span className="ve-title-cell__name">{profile.name}</span>
                        <span className="ve-title-cell__meta">{`#${profile.id}`}</span>
                      </span>
                    </TableCell>
                    <TableCell className="ve-c-pair">
                      <EngineResolverPair engineName={engineName} resolverName={resolverName} />
                    </TableCell>
                    <TableCell className="ve-c-retry">
                      <Chip>{profile.retry_mode ?? "none"}</Chip>
                    </TableCell>
                    <TableCell>
                      <span className="t-mono-inline ellipsis">
                        {profile.requester_user_token == null || profile.requester_user_token === ""
                          ? "—"
                          : profile.requester_user_token.slice(0, 12)}
                      </span>
                    </TableCell>
                    <TableCell className="ve-c-refs">
                      <span className="t-mono-inline num">
                        {`${counts.autoruns} autoruns · ${counts.sessions} sessions`}
                      </span>
                    </TableCell>
                    <TableCell className="ve-c-actions">
                      <span className="ve-inline">
                        <Button variant="secondary" onClick={() => setUseTarget(profile)}>
                          Use profile
                        </Button>
                        <OverflowMenu
                          items={[
                            {
                              id: "edit",
                              label: "Edit",
                              onSelect: () => {
                                setEditing(profile)
                                setEditorOpen(true)
                              },
                            },
                            { id: "export", label: "Export", onSelect: () => void doExport(profile) },
                            {
                              id: "delete",
                              label: "Delete",
                              destructive: true,
                              disabled: inUse(profile),
                              disabledReason: inUse(profile)
                                ? `In use by ${counts.autoruns} autoruns and ${counts.sessions} sessions — delete those first.`
                                : undefined,
                              onSelect: () => {
                                setDeleteError(null)
                                setDeleteTarget(profile)
                              },
                            },
                          ]}
                          triggerLabel={`Actions for ${profile.name}`}
                        />
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ProfileEditorDialog
        key={`profile-editor-${editorOpen ? "open" : "closed"}-${editing?.id ?? "new"}`}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        editing={editing}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null)
          setDeleteError(null)
        }}
        onConfirm={() => {
          if (deleteTarget !== null) void doDelete(deleteTarget)
        }}
        title={`Delete profile '${deleteTarget?.name ?? ""}'?`}
        body={
          deleteError !== null ? (
            <p>{deleteError}</p>
          ) : (
            <p>Any scheduled recording that references it must be deleted first. This cannot be undone.</p>
          )
        }
        tone="destructive"
        confirmLabel="Delete"
      />

      <NewSessionDialog
        key={`use-session-${useTarget !== null ? "open" : "closed"}-${useTarget?.id ?? "new"}`}
        open={useTarget !== null}
        onClose={() => setUseTarget(null)}
        prefillProfileId={useTarget?.id ?? null}
      />

      {list.items.length > 0 ? (
        <div className="ve-bar">
          <span className="ve-note">{`Showing ${list.items.length}${list.hasMore ? "+" : ""}`}</span>
          <div className="ve-bar__end">
            {list.hasMore ? (
              <Button variant="secondary" loading={list.isFetching} onClick={list.loadMore}>
                Load more
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
