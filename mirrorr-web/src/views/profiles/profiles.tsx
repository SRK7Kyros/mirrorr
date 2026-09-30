import { useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { OverflowMenu } from "@/components/ui/OverflowMenu"
import { SkeletonList } from "@/components/ui/Skeleton"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import { isAdmin } from "@/lib/auth"
import { queryKeys, queryRoots, resolveEntityName } from "@/lib/query-keys"
import type { Autorun, Profile, Session } from "@/lib/schemas"
import {
  deleteProfile,
  downloadJson,
  fetchAutorunPage,
  fetchProfileExport,
  fetchProfilePage,
  fetchSessionPage,
} from "@/views/shared/api"
import {
  removeFromInfiniteLists,
  useEntityList,
  useHighlightRef,
  useNameMaps,
  useProfiles,
} from "@/views/shared/hooks"
import { NewSessionDialog } from "@/views/sessions/new-session-dialog"
import { ProfileEditorDialog } from "./profile-editor-dialog"

function highlightParam(): number | null {
  if (typeof window === "undefined") return null
  const raw = new URLSearchParams(window.location.search).get("highlight")
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

interface InUseRefs {
  readonly autoruns: number
  readonly sessions: number
}

/** V8 — Profiles list + editor (DynamicSchemaForm), Export, Use, delete pre-scan. */
export function ProfilesView() {
  const names = useNameMaps()
  const profiles = useProfiles()
  const client = useQueryClient()
  const { toast } = useToast()
  const admin = isAdmin()

  const list = useEntityList<Profile>({
    queryKey: queryKeys.profiles({}),
    fetchPage: (cursor) => fetchProfilePage(cursor),
  })
  const autorunList = useEntityList<Autorun>({
    queryKey: queryKeys.autoruns({}),
    fetchPage: (cursor) => fetchAutorunPage(cursor),
  })
  const sessionList = useEntityList<Session>({
    queryKey: queryKeys.sessions({}),
    fetchPage: (cursor) => fetchSessionPage(cursor),
  })

  const highlight = useHighlightRef(highlightParam())
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Profile | null>(null)
  const [useTarget, setUseTarget] = useState<Profile | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)
  const [deleteRefs, setDeleteRefs] = useState<InUseRefs | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const refsFor = (profile: Profile): InUseRefs => ({
    autoruns: autorunList.items.filter((autorun) => autorun.profile_id === profile.id).length,
    sessions: sessionList.items.filter((session) => session.profile_id === profile.id).length,
  })

  const openDelete = (profile: Profile) => {
    setDeleteTarget(profile)
    setDeleteRefs(refsFor(profile))
    setDeleteError(null)
  }

  const removeProfile = async (profile: Profile) => {
    try {
      await deleteProfile(profile.id)
      removeFromInfiniteLists(client, queryRoots.profiles, profile.id)
      void client.invalidateQueries({ queryKey: queryRoots.profiles })
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        setDeleteRefs(refsFor(profile))
        setDeleteError(error.message)
      } else {
        toast({ kind: "error", title: "Delete failed" })
      }
    }
  }

  const exportProfile = async (profile: Profile) => {
    try {
      const bundle = await fetchProfileExport(profile.id)
      const ok = downloadJson(`${profile.name}.json`, bundle)
      if (!ok) throw new Error("download failed")
    } catch {
      toast({
        kind: "error",
        title: "Export ready — copy the JSON",
        action: {
          label: "Copy",
          onClick: () => {
            void fetchProfileExport(profile.id).then((bundle) => {
              void navigator.clipboard.writeText(JSON.stringify(bundle, null, 2))
            })
          },
        },
      })
    }
  }

  const rows = useMemo(
    () =>
      list.items.map((profile) => (
        <tr key={profile.id} className="entity-row" data-id={profile.id} ref={highlight}>
          <td data-col="name" className="cell-strong">
            {profile.name}
          </td>
          <td data-col="engine">
            {resolveEntityName(profile.engine_name, names.engines, profile.default_engine_id)}
          </td>
          <td data-col="resolver">
            {resolveEntityName(profile.resolver_name, names.resolvers, profile.resolver_id)}
          </td>
          <td data-col="retry">
            <span className="t-mono-inline">{profile.retry_mode ?? "—"}</span>
          </td>
          {admin ? (
            <td data-col="owner">
              <span className="t-mono-inline ellipsis">
                {profile.requester_user_token == null || profile.requester_user_token === ""
                  ? "—"
                  : profile.requester_user_token.slice(0, 12)}
              </span>
            </td>
          ) : null}
          <td data-col="actions">
            <span className="cluster">
              <Button
                variant="ghost"
                className="row-primary-action"
                onClick={() => setUseTarget(profile)}
              >
                Use
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
                  { id: "export", label: "Export", onSelect: () => void exportProfile(profile) },
                  {
                    id: "delete",
                    label: "Delete",
                    destructive: true,
                    onSelect: () => openDelete(profile),
                  },
                ]}
                triggerLabel={`Actions for ${profile.name}`}
              />
            </span>
          </td>
        </tr>
      )),
    [list.items, names, admin, highlight],
  )

  const blocked =
    deleteRefs !== null && (deleteRefs.autoruns > 0 || deleteRefs.sessions > 0)

  return (
    <div className="view">
      <div className="view-header">
        <div className="view-header__actions">
          <Button
            variant="primary"
            onClick={() => {
              setEditing(null)
              setEditorOpen(true)
            }}
          >
            New profile
          </Button>
        </div>
      </div>

      {list.isLoading ? (
        <SkeletonList rows={5} />
      ) : list.isError ? (
        <ErrorPanel
          title="Request failed"
          body={list.error instanceof Error ? list.error.message : "Unexpected server response"}
          actions={
            <Button variant="ghost" onClick={list.refetch}>
              Retry
            </Button>
          }
        />
      ) : profiles.length === 0 ? (
        <EmptyState
          headline="No profiles"
          body="No profiles — save a reusable configuration"
          action={
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null)
                setEditorOpen(true)
              }}
            >
              New profile
            </Button>
          }
        />
      ) : (
        <table className="entity-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Engine</th>
              <th scope="col">Resolver</th>
              <th scope="col">Retry mode</th>
              {admin ? (
                <th scope="col" data-col="owner">
                  Owner
                </th>
              ) : null}
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      )}

      {list.items.length > 0 && list.hasMore ? (
        <div className="list-footer">
          <span className="num">{`Showing ${list.items.length}`}</span>
          <Button variant="ghost" loading={list.isFetching} onClick={list.loadMore}>
            Load more
          </Button>
        </div>
      ) : null}

      <ProfileEditorDialog
        key={`${editorOpen ? "open" : "closed"}-${editing?.id ?? "new"}`}
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        editing={editing}
      />

      <NewSessionDialog
        key={`${useTarget !== null ? "open" : "closed"}-${useTarget?.id ?? "new"}`}
        open={useTarget !== null}
        onClose={() => setUseTarget(null)}
        prefillProfileId={useTarget?.id ?? null}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null)
          setDeleteError(null)
        }}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (target !== null) void removeProfile(target)
        }}
        title={`Delete profile '${deleteTarget?.name ?? ""}'?`}
        body={
          <div>
            {blocked && deleteRefs !== null ? (
              <>
                <p>{`In use by ${deleteRefs.autoruns} autoruns / ${deleteRefs.sessions} sessions`}</p>
                <p>Remove those first — deletion is blocked while referenced.</p>
              </>
            ) : (
              <p>This cannot be undone.</p>
            )}
            {deleteError !== null ? <p className="warn-text">{deleteError}</p> : null}
          </div>
        }
        tone={blocked ? "block" : "destructive"}
        confirmLabel={blocked ? "Close" : "Delete"}
      />
    </div>
  )
}
