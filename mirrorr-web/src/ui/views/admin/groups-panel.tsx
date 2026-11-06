import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createGroup,
  deleteGroup,
  fetchGroups,
  fetchUsers,
  getErrorMessage,
  setGroupMembers,
  updateGroup,
} from "@/api"
import { ApiError } from "@/api/client"
import { rankBySearch } from "@/api/domain/search"
import { queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import type { Group } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import {
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconPlus,
  Input,
  PageToolbar,
  Panel,
  PanelBody,
  PanelHead,
  QueryState,
  RowActions,
  SkeletonRows,
  Table,
  Tag,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { AdminSearch } from "./admin-search"
import { countLabel } from "./format"

/**
 * Groups (plan: granular-permissions-and-access-panel, Wave 6). Admin-only CRUD
 * over the group list. The sealed `everyone` row (`system: true`) is read-only —
 * the server rejects its rename, delete and member edits — so it shows no
 * affordances and says why.
 */
export function GroupsPanel() {
  const queryClient = useQueryClient()
  const groupsQuery = useQuery({ queryKey: queryKeys.groups, queryFn: fetchGroups, staleTime: staleTimes.users })
  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })
  const [search, setSearch] = useState("")
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Group | null>(null)
  const [membersTarget, setMembersTarget] = useState<Group | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null)

  const remove = useMutation({
    mutationFn: (id: number) => deleteGroup(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      void queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
      toast.success("Group deleted")
    },
    onError: (caught) => toast.error("Could not delete group", getErrorMessage(caught, "Try again")),
  })

  const users = usersQuery.data ?? []
  const groups = groupsQuery.data?.items ?? []
  const rows = useMemo(
    () =>
      search.trim() === ""
        ? groups
        : rankBySearch(groups, search, (group) => [group.display_name, group.name]),
    [groups, search],
  )

  const empty =
    groups.length === 0 ? (
      <EmptyState
        title="No groups"
        text="Create a group to grant the same access to several accounts at once."
      />
    ) : (
      <EmptyState
        title="Nothing matches this search"
        text="Clear the search box to see every group."
      />
    )

  const rowActions = (group: Group) => [
    { label: "Members", onSelect: () => setMembersTarget(group) },
    { label: "Edit group", onSelect: () => setEditTarget(group) },
    {
      label: "Delete group",
      danger: true,
      separatorBefore: true,
      onSelect: () => setDeleteTarget(group),
    },
  ]

  return (
    <Panel>
      <PanelHead
        title="Groups"
        actions={
          <Button size="sm" variant="secondary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
            Add group
          </Button>
        }
      />
      <PanelBody flush className="border-b border-line-subtle p-3">
        <PageToolbar
          search={
            <AdminSearch
              value={search}
              onChange={setSearch}
              label="Search groups"
              placeholder="Filter by name…"
            />
          }
          count={countLabel(groups.length, "group")}
        />
      </PanelBody>
      <PanelBody flush>
        <div className="p-3">
          <QueryState
            query={groupsQuery}
            loading={<SkeletonRows cols={3} />}
            isEmpty={rows.length === 0}
            empty={empty}
            errorMessage="Could not load groups"
          >
            <div className="hidden min-[672px]:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Group</Th>
                    <Th>Members</Th>
                    <Th className="cell-actions">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((group) => (
                    <tr key={group.id}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="truncate text-base font-medium text-ink">
                            {group.display_name !== "" ? group.display_name : group.name}
                          </span>
                          {group.system ? <Tag>System</Tag> : null}
                        </div>
                        <div className="text-xs text-ink-dim [font-family:var(--font-mono)]">@{group.name}</div>
                        {group.system ? (
                          <div className="text-xs text-ink-muted">
                            Every account, including future ones — membership is implicit.
                          </div>
                        ) : null}
                      </Td>
                      <Td className="text-ink-muted">
                        {group.system ? (
                          "Everyone"
                        ) : (
                          <button
                            type="button"
                            aria-label={`${countLabel(group.member_count, "member")} of ${group.name}`}
                            className="tab-stop text-left underline-offset-2 [&:hover]:underline"
                            onClick={() => setMembersTarget(group)}
                          >
                            {countLabel(group.member_count, "member")}
                          </button>
                        )}
                      </Td>
                      <Td actions>
                        {group.system ? null : (
                          <RowActions label={`Actions for ${group.name}`} actions={rowActions(group)} />
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-line-subtle min-[672px]:hidden">
              {rows.map((group) => (
                <li key={group.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-base font-medium text-ink">
                        {group.display_name !== "" ? group.display_name : group.name}
                      </span>
                      {group.system ? <Tag>System</Tag> : null}
                    </div>
                    <div className="truncate text-xs text-ink-dim [font-family:var(--font-mono)]">
                      @{group.name}
                    </div>
                    <div className="mt-1 text-sm text-ink-muted">
                      {group.system ? (
                        "Everyone"
                      ) : (
                        <button
                          type="button"
                          aria-label={`${countLabel(group.member_count, "member")} of ${group.name}`}
                          className="tab-stop text-left underline-offset-2 [&:hover]:underline"
                          onClick={() => setMembersTarget(group)}
                        >
                          {countLabel(group.member_count, "member")}
                        </button>
                      )}
                    </div>
                  </div>
                  {group.system ? null : (
                    <RowActions label={`Actions for ${group.name}`} actions={rowActions(group)} />
                  )}
                </li>
              ))}
            </ul>
          </QueryState>
        </div>
      </PanelBody>

      <CreateGroupDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editTarget !== null ? <EditGroupDialog group={editTarget} onClose={() => setEditTarget(null)} /> : null}
      {membersTarget !== null ? (
        <GroupMembersDialog group={membersTarget} users={users} onClose={() => setMembersTarget(null)} />
      ) : null}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete group"
        description={
          deleteTarget !== null
            ? `“${deleteTarget.name}” loses its grants and ownership rows. Members keep their own access.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget === null) return
          try {
            await remove.mutateAsync(deleteTarget.id)
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />
    </Panel>
  )
}

interface CreateGroupDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

function CreateGroupDialog({ open, onClose }: CreateGroupDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  function reset(): void {
    setName("")
    setDisplayName("")
    setError(null)
    setFieldErrors({})
  }

  const create = useMutation({
    mutationFn: () => createGroup(name.trim(), displayName.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      toast.success("Group created", name.trim())
      reset()
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not create group"))
    },
  })

  function handleClose(): void {
    if (create.isPending) return
    reset()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      busy={create.isPending}
      title="Add group"
      description="A group grants the same access to every member."
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="create-group-form" variant="primary" loading={create.isPending}>
            Create group
          </Button>
        </>
      }
    >
      <form
        id="create-group-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (create.isPending) return
          setError(null)
          setFieldErrors({})
          create.mutate()
        }}
        noValidate
      >
        {error !== null ? <Banner kind="danger" title={error} /> : null}
        <Field
          label="Name"
          htmlFor="new-group-name"
          required
          hint="Lowercase identifier, e.g. editors."
          error={fieldErrors.name ?? null}
        >
          <Input id="new-group-name" autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="Display name" htmlFor="new-group-display" hint="Shown wherever the group appears.">
          <Input
            id="new-group-display"
            autoComplete="off"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  )
}

interface EditGroupDialogProps {
  readonly group: Group
  readonly onClose: () => void
}

function EditGroupDialog({ group, onClose }: EditGroupDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(group.name)
  const [displayName, setDisplayName] = useState(group.display_name)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  const save = useMutation({
    mutationFn: () => updateGroup(group.id, { name: name.trim(), display_name: displayName.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      void queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
      toast.success("Group updated", name.trim())
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not update group"))
    },
  })

  return (
    <Dialog
      open
      onClose={onClose}
      busy={save.isPending}
      title={`Edit ${group.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-group-form" variant="primary" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="edit-group-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (save.isPending) return
          setError(null)
          setFieldErrors({})
          save.mutate()
        }}
        noValidate
      >
        {error !== null ? <Banner kind="danger" title={error} /> : null}
        <Field label="Name" htmlFor="edit-group-name" required error={fieldErrors.name ?? null}>
          <Input
            id="edit-group-name"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Display name" htmlFor="edit-group-display">
          <Input
            id="edit-group-display"
            autoComplete="off"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  )
}

interface GroupMembersDialogProps {
  readonly group: Group
  readonly users: readonly User[]
  readonly onClose: () => void
}

function GroupMembersDialog({ group, users, onClose }: GroupMembersDialogProps) {
  const queryClient = useQueryClient()
  const [members, setMembers] = useState<readonly string[]>(group.members)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => setGroupMembers(group.id, members),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      toast.success("Members updated", `${updated.member_count} in ${updated.name}`)
      onClose()
    },
    onError: (caught) => setError(getErrorMessage(caught, "Could not update members")),
  })

  const allSelected = users.length > 0 && users.every((user) => members.includes(user.username))

  return (
    <Dialog
      open
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={`Members · ${group.name}`}
      description={`${members.length} of ${users.length} accounts selected.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save members
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null ? <Banner kind="danger" title={error} /> : null}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={save.isPending || allSelected}
            onClick={() => setMembers(users.map((user) => user.username))}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={save.isPending || members.length === 0}
            onClick={() => setMembers([])}
          >
            Clear
          </Button>
        </div>
        <div className="flex max-h-[42vh] flex-col gap-1 overflow-y-auto">
          {users.map((user) => (
            <Checkbox
              key={user.username}
              label={user.display_name !== "" ? user.display_name : user.username}
              checked={members.includes(user.username)}
              disabled={save.isPending}
              onChange={(event) =>
                setMembers((current) =>
                  event.target.checked
                    ? [...current, user.username]
                    : current.filter((username) => username !== user.username),
                )
              }
            />
          ))}
        </div>
      </div>
    </Dialog>
  )
}
