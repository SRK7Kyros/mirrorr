/**
 * V8 — profiles (spec L323-L337, contract §3/§13.6).
 *
 * List + editor; the delete path pre-scans the cached autoruns/sessions and
 * lists what references the profile before confirming ("in use by N autoruns /
 * M sessions", spec L331 — the FK rule is server-enforced, the dialog is the
 * client's pre-emption). Row "Use" opens D1 prefilled; row "Export" downloads
 * the single-profile bundle (todo 23, `ExportBundleButton`).
 */
import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useIsCompactShell } from "@/components/chrome/CompactShell"
import { ExportFallbackDialog } from "@/components/import-export/ExportFallbackDialog"
import { ProfileEditorDialog } from "@/components/profiles/ProfileEditorDialog"
import { ProfileRowActions, profileActionItems } from "@/components/profiles/ProfileRowActions"
import { NewSessionDialog } from "@/components/sessions/NewSessionDialog"
import { Button } from "@/components/ui/Button"
import { CompactCardList } from "@/components/ui/CompactCardList"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { EMPTY_STATES, EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { SKELETON_PRESETS, SkeletonRows } from "@/components/ui/SkeletonRows"
import { Table, type TableColumn } from "@/components/ui/Table"
import { useHighlight } from "@/hooks/use-highlight"
import { useCompactAction } from "@/hooks/use-compact-action"
import { useInfiniteList } from "@/hooks/use-infinite-list"
import { usePollingPolicy } from "@/hooks/use-polling-policy"
import { useNameMap } from "@/hooks/use-name-map"
import { useStorePendingVersion } from "@/hooks/use-store-pending"
import { getAuthState } from "@/lib/auth-store"
import type { EntityStore } from "@/lib/entity-store"
import { entityStore } from "@/lib/entity-store-client"
import { ApiError, userMessageForError } from "@/lib/errors"
import { exportBundleToFile } from "@/lib/export-bundle"
import { deleteEntity } from "@/lib/optimistic-policy"
import { collectProfileRefs, type ProfileRefs } from "@/lib/profile-refs"
import { deleteProfile, fetchProfilesPage } from "@/lib/profiles-api"
import { queryKeys } from "@/lib/query-keys"
import type { Profile } from "@/lib/schemas/plugins"
import { showToast } from "@/lib/toast"

export interface ProfilesViewProps {
  readonly highlight?: number | null
  readonly store?: EntityStore
}

const NO_REFS: ProfileRefs = { autoruns: [], sessions: [] }

export function ProfilesView({ highlight = null, store = entityStore }: ProfilesViewProps) {
  const queryClient = useQueryClient()
  const { nameFor, invalidateNames } = useNameMap()
  useStorePendingVersion(store)

  const polling = usePollingPolicy("list")
  const list = useInfiniteList<Profile>({
    queryKey: queryKeys.profiles(),
    fetchPage: fetchProfilesPage,
    refetchInterval: polling.refetchInterval,
    refetchOnWindowFocus: polling.refetchOnWindowFocus,
  })

  const isAdmin = getAuthState().user?.role === "admin"
  const [editorOpen, setEditorOpen] = useState(false)
  const [editorProfile, setEditorProfile] = useState<Profile | null>(null)
  const [useTarget, setUseTarget] = useState<Profile | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null)
  const [refs, setRefs] = useState<ProfileRefs | null>(null)
  const [scanning, setScanning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const ids = useMemo(() => list.rows.map((row) => row.id), [list.rows])
  const { containerRef, highlightedId } = useHighlight<HTMLDivElement>(highlight, ids)

  useEffect(() => {
    return store.subscribeFrames((frame) => {
      if (frame.event.startsWith("profile.")) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.profilesAll(), type: "all" })
        if (frame.event !== "profile.deleted") {
          void queryClient.invalidateQueries({ queryKey: queryKeys.profile(frame.id) })
        }
        invalidateNames("profile")
      }
    })
  }, [queryClient, store, invalidateNames])

  function openCreate() {
    setEditorProfile(null)
    setEditorOpen(true)
  }

  function openEdit(profile: Profile) {
    setEditorProfile(profile)
    setEditorOpen(true)
  }

  async function beginDelete(profile: Profile) {
    setDeleteTarget(profile)
    setRefs(null)
    setDeleteError(null)
    setScanning(true)
    try {
      setRefs(await collectProfileRefs(queryClient, profile.id))
    } catch {
      // The scan is advisory; the server still owns the FK rule, so fall back
      // to the plain confirm without blocking the dialog.
      setRefs(NO_REFS)
    } finally {
      setScanning(false)
    }
  }

  async function confirmDelete() {
    if (deleteTarget === null) return
    setDeleting(true)
    try {
      await deleteEntity(store, {
        resource: "profile",
        id: deleteTarget.id,
        mutate: () => deleteProfile(deleteTarget.id),
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.profiles(), type: "all" })
      invalidateNames("profile")
      setDeleteTarget(null)
    } catch (error) {
      if (error instanceof ApiError && (error.status === 400 || error.status === 409)) {
        setDeleteError(error.detail)
      } else {
        showToast(userMessageForError(error))
        setDeleteTarget(null)
      }
    } finally {
      setDeleting(false)
    }
  }

  const refCount = (refs?.autoruns.length ?? 0) + (refs?.sessions.length ?? 0)

  const compact = useIsCompactShell()
  const [exportFallback, setExportFallback] = useState<string | null>(null)

  const columns: TableColumn<Profile>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <span
          data-testid={`profile-name-${row.id}`}
          data-entity-id={row.id}
          data-highlighted={highlightedId === row.id ? "true" : undefined}
          className={highlightedId === row.id ? "rounded-control px-1 ring-2 ring-accent" : undefined}
        >
          {row.name}
        </span>
      ),
    },
    {
      key: "engine",
      header: "Engine",
      render: (row) => row.engine_name ?? nameFor("engine", row.default_engine_id) ?? `#${row.default_engine_id}`,
    },
    {
      key: "resolver",
      header: "Resolver",
      render: (row) => row.resolver_name ?? nameFor("resolver", row.resolver_id) ?? `#${row.resolver_id}`,
    },
    { key: "retry", header: "Retry mode", render: (row) => row.retry_mode ?? "none" },
    ...(isAdmin
      ? [
          {
            key: "owner",
            header: "Owner",
            render: (row: Profile) => row.requester_user_token ?? "—",
          },
        ]
      : []),
    {
      key: "actions",
      header: "Actions",
      align: "right" as const,
      render: (row) => (
        <ProfileRowActions
          profile={row}
          pending={store.getPending("profile", row.id) !== undefined}
          onUse={() => setUseTarget(row)}
          onEdit={() => openEdit(row)}
          onDelete={() => void beginDelete(row)}
        />
      ),
    },
  ]

  useCompactAction("new-profile", openCreate)

  function columnFor(key: string) {
    return columns.find((column) => column.key === key)
  }

  /** Spec L545 V8 card anatomy: name, engine → resolver, retry mode. */
  function renderProfileCard(row: Profile) {
    const cell = (key: string) => columnFor(key)?.render(row) ?? null

    return (
      <>
        <span className="flex items-center gap-2">{cell("name")}</span>
        <span className="flex flex-wrap items-center gap-2 text-small text-text-secondary">
          {cell("engine")}
          <span aria-hidden="true" className="text-text-muted">
            →
          </span>
          {cell("resolver")}
        </span>
        <span className="flex flex-wrap items-center gap-2 text-small text-text-secondary">{cell("retry")}</span>
        {isAdmin ? <span className="text-small text-text-secondary">{cell("owner")}</span> : null}
      </>
    )
  }

  async function handleExport(row: Profile) {
    try {
      const outcome = await exportBundleToFile("profile", row.id)
      if (!outcome.downloaded) setExportFallback(outcome.text)
    } catch (error) {
      showToast(userMessageForError(error))
    }
  }

  function cardActions(row: Profile) {
    return profileActionItems({
      profile: row,
      exportDisabled: store.getPending("profile", row.id) !== undefined,
      onUse: () => setUseTarget(row),
      onEdit: () => openEdit(row),
      onExport: () => void handleExport(row),
      onDelete: () => void beginDelete(row),
    })
  }

  return (
    <main data-testid="profiles-view" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-title font-semibold text-text-primary">Profiles</h1>
        <Button variant="primary" icon={Plus} onClick={openCreate}>
          New profile
        </Button>
      </div>

      {list.isInitialLoading ? (
        <SkeletonRows variant={SKELETON_PRESETS.sessions.variant} count={SKELETON_PRESETS.sessions.count} label="Loading profiles" />
      ) : null}

      {list.isError ? (
        <ErrorPanel
          message={userMessageForError(list.error)}
          onRetry={() => void queryClient.invalidateQueries({ queryKey: queryKeys.profilesAll(), type: "all" })}
        />
      ) : null}

      {!list.isInitialLoading && !list.isError && list.rows.length === 0 ? (
        <EmptyState title={EMPTY_STATES.profiles} icon={Plus} />
      ) : null}

      {list.rows.length > 0 ? (
        <div ref={containerRef}>
          {compact ? (
            <CompactCardList
              label="Profiles"
              rows={list.rows}
              getRowKey={(row) => row.id}
              renderCard={renderProfileCard}
              actionsFor={cardActions}
              onOpen={openEdit}
              openLabel={(row) => `Edit ${row.name}`}
              sheetTitle={(row) => `Profile ${row.name} actions`}
            />
          ) : (
            <Table label="Profiles" columns={columns} rows={list.rows} getRowKey={(row) => row.id} />
          )}
        </div>
      ) : null}

      {list.hasMore ? (
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => void list.loadMore()} disabled={list.isLoadingMore}>
            {list.isLoadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}

      <ProfileEditorDialog
        open={editorOpen}
        profile={editorProfile}
        onClose={() => setEditorOpen(false)}
        store={store}
      />

      <NewSessionDialog open={useTarget !== null} prefillProfile={useTarget} onClose={() => setUseTarget(null)} />

      <ExportFallbackDialog json={exportFallback} onClose={() => setExportFallback(null)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete profile?"
        body={
          deleteTarget === null ? null : (
            <span className="flex flex-col gap-2">
              <span>{`Delete "${deleteTarget.name}"?`}</span>
              {scanning ? <span>Checking references…</span> : null}
              {refs !== null && refCount > 0 ? (
                <>
                  <span data-testid="profile-in-use-summary">{`In use by ${refs.autoruns.length} autoruns / ${refs.sessions.length} sessions`}</span>
                  <ul className="flex list-disc flex-col gap-0.5 pl-4">
                    {refs.autoruns.map((ref) => (
                      <li key={`autorun-${ref.id}`}>{ref.name}</li>
                    ))}
                    {refs.sessions.map((ref) => (
                      <li key={`session-${ref.id}`}>{ref.name}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {deleteError !== null ? <span className="text-danger">{deleteError}</span> : null}
            </span>
          )
        }
        confirmLabel="Delete profile"
        pending={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </main>
  )
}
