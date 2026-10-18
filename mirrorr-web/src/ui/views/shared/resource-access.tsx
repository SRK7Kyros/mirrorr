import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  type AccessOverride,
  type AccessTarget,
  type Crown,
  type ItemAccess,
  crownKey,
  emptyGroupGrants,
} from "@/api/domain/access-plan";
import { rankBySearch } from "@/api/domain/search";
import { CAPABILITIES, type Capability } from "@/api/schemas/privileged";
import type { User } from "@/api/schemas/user";
import { Avatar, Button, IconButton, Input } from "@/ui/components";
import {
  IconAlert,
  IconCheck,
  IconCrown,
  IconSearch,
  IconUser,
  IconX,
} from "@/ui/components/icons";
import { useSelection } from "@/ui/hooks";
import { cn } from "@/ui/lib/cn";
import { useMarqueeSelection } from "./marquee";

export const RESOURCE_TYPE_LABEL: Record<string, string> = {
  session: "Session",
  profile: "Profile",
  autorun: "Autorun",
  recording: "Recording",
  source: "Source",
  engine: "Engine",
  resolver: "Resolver",
};

export function resourceTypeLabel(type: string): string {
  return RESOURCE_TYPE_LABEL[type] ?? type;
}

export function userLabel(user: User): string {
  return user.display_name !== "" ? user.display_name : user.username;
}

export function usernameLabel(
  users: readonly User[],
  username: string,
): string {
  const user = users.find((candidate) => candidate.username === username);
  return user === undefined ? `${username} (missing)` : userLabel(user);
}

/** The primary owner's label: the user's name, the group's, or the empty copy. */
export function crownLabel(
  crown: Crown | null,
  users: readonly User[],
  groups: readonly AccessGroup[],
  empty: string,
): string {
  if (crown === null) return empty;
  if (crown.kind === "user") return usernameLabel(users, crown.username);
  const group = groups.find((candidate) => candidate.id === crown.groupId);
  return group === undefined ? `Group #${crown.groupId}` : groupLabel(group);
}

/**
 * `override.count` is the number of distinct users holding *any* capability, so
 * the copy names users, not view grants — the old "N view grants" described a
 * flat viewer list that no longer exists.
 */
export function overrideLabel(override: AccessOverride): string {
  if (override.kind === "owner-missing") return "Owner account missing";
  return override.count === 1
    ? "1 user or group with access"
    : `${override.count} users or groups with access`;
}

/**
 * Capability labels, in the frozen `CAPABILITIES` order. Only `VIEW` keeps its
 * established copy ("View access") — the e2e and unit specs pin that exact
 * string, so renaming it is a contract change, not a wording preference.
 */
export const CAPABILITY_LABEL: Record<Capability, string> = {
  VIEW: "View access",
  OPERATE: "Operate",
  EDIT: "Edit",
  DELETE: "Delete",
  SHARE: "Share",
  EXPORT: "Export",
};

/** The established label for one capability ("View access", "Operate", …). */
export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_LABEL[capability];
}

/**
 * The capabilities each owner-bearing type actually enforces — the editor
 * offers only controls the core honours (routes in
 * `mirrorr-core/src/mirrorr/api/routers/`). A capability with no route for a
 * type is inert, so it is not offered. Engines and resolvers are ownerless
 * system rows that never open this editor, so an unknown type keeps all six.
 */
export const TYPE_CAPABILITIES: Record<string, readonly Capability[]> = {
  session: ["VIEW", "OPERATE", "EDIT", "DELETE", "SHARE"], // view/list/detail+logs · stop/recording · save-as-profile · delete · shares
  autorun: ["VIEW", "EDIT", "DELETE", "SHARE", "EXPORT"], // view · update+save-as-profile · delete · shares · /import-export/autoruns/{id}/export
  recording: ["VIEW", "DELETE", "SHARE"], // view · delete · shares
  profile: ["VIEW", "EDIT", "DELETE", "SHARE", "EXPORT"], // view · update+profile-link · delete · shares · /import-export/profiles/{id}/export
  source: ["VIEW", "EDIT", "DELETE", "SHARE"], // view · update · delete · shares
};

/** The capabilities the editor offers for a type (all six when it is unknown). */
export function offeredCapabilities(
  resourceType: string,
): readonly Capability[] {
  return TYPE_CAPABILITIES[resourceType] ?? CAPABILITIES;
}

/**
 * VIEW is the base capability: a user who holds anything at all holds VIEW,
 * because the core implies it. Every read of a capability set goes through this
 * so a stray OPERATE-only row still reads as visible.
 */
export function holdsCapability(
  grants: Readonly<Record<Capability, readonly string[]>>,
  capability: Capability,
  username: string,
): boolean {
  if (capability === "VIEW") {
    return CAPABILITIES.some((candidate) =>
      grants[candidate].includes(username),
    );
  }
  return grants[capability].includes(username);
}

/* ── groups (plan: granular-permissions-and-access-panel, wave 6) ───────
 *
 * A group is a principal just like a user: it can be the target of capability
 * grants and, additionally, an owner (ownership is ADDITIVE — the single user
 * owner is untouched). The editor lists both kinds in one catalog and applies
 * the same chip machinery to either, so a group grant and a user grant differ
 * only in which record they land in. The reserved `everyone` group is always
 * offered and covers every account, existing and future.
 */

/** A group as the editor renders it — a `GET /groups` item, member list aside. */
export interface AccessGroup {
  readonly id: number;
  readonly name: string;
  readonly display_name: string;
  readonly system: boolean;
  readonly member_count?: number;
}

/** The group's human label — its `display_name`, falling back to its name. */
export function groupLabel(group: AccessGroup): string {
  return group.display_name !== "" ? group.display_name : group.name;
}

/** The reserved `everyone` group — the only one that covers future accounts. */
export function isEveryoneGroup(group: AccessGroup): boolean {
  return group.system === true || group.name === "everyone";
}

/** What the `everyone` group's membership line reads, in place of a count. */
export const EVERYONE_NOTE = "every account, including future ones";

/** The loud inline warning shown while `everyone` owns an item. */
export const EVERYONE_OWNER_WARNING =
  "Everyone is an owner: every account, including future ones, gets every permission on this item — delete included.";

/** The member line on a group card — a count, or the implicit-membership note. */
export function groupMembersLabel(group: AccessGroup): string {
  if (isEveryoneGroup(group)) return EVERYONE_NOTE;
  const count = group.member_count ?? 0;
  return count === 1 ? "1 member" : `${count} members`;
}

/** VIEW is the base capability for a group too: any held capability implies it. */
export function holdsGroupCapability(
  groupGrants: Readonly<Record<Capability, readonly number[]>>,
  capability: Capability,
  groupId: number,
): boolean {
  if (capability === "VIEW") {
    return CAPABILITIES.some((candidate) =>
      (groupGrants[candidate] ?? []).includes(groupId),
    );
  }
  return (groupGrants[capability] ?? []).includes(groupId);
}

function grantCapability(
  access: ItemAccess,
  capability: Capability,
  username: string,
): ItemAccess {
  const alreadyHeld = access.grants[capability].includes(username);
  const needsView =
    capability !== "VIEW" && !access.grants.VIEW.includes(username);
  if (alreadyHeld && !needsView) return access;
  const grants = { ...access.grants };
  if (!alreadyHeld) grants[capability] = [...grants[capability], username];
  if (needsView) grants.VIEW = [...grants.VIEW, username];
  return { ...access, grants };
}

function revokeCapability(
  access: ItemAccess,
  capability: Capability,
  username: string,
): ItemAccess {
  if (capability === "VIEW") {
    // Clearing the base capability clears what it implies.
    const grants = { ...access.grants };
    let changed = false;
    for (const candidate of CAPABILITIES) {
      if (!grants[candidate].includes(username)) continue;
      grants[candidate] = grants[candidate].filter((name) => name !== username);
      changed = true;
    }
    return changed ? { ...access, grants } : access;
  }
  if (!access.grants[capability].includes(username)) return access;
  return {
    ...access,
    grants: {
      ...access.grants,
      [capability]: access.grants[capability].filter(
        (name) => name !== username,
      ),
    },
  };
}

function groupGrantRecord(access: ItemAccess): Record<Capability, number[]> {
  const groupGrants = emptyGroupGrants();
  for (const capability of CAPABILITIES)
    groupGrants[capability] = [...(access.groupGrants?.[capability] ?? [])];
  return groupGrants;
}

function grantGroupCapability(
  access: ItemAccess,
  capability: Capability,
  groupId: number,
): ItemAccess {
  const groupGrants = groupGrantRecord(access);
  const alreadyHeld = groupGrants[capability].includes(groupId);
  const needsView =
    capability !== "VIEW" && !groupGrants.VIEW.includes(groupId);
  if (alreadyHeld && !needsView) return access;
  if (!alreadyHeld)
    groupGrants[capability] = [...groupGrants[capability], groupId];
  if (needsView) groupGrants.VIEW = [...groupGrants.VIEW, groupId];
  return { ...access, groupGrants };
}

function revokeGroupCapability(
  access: ItemAccess,
  capability: Capability,
  groupId: number,
): ItemAccess {
  const groupGrants = groupGrantRecord(access);
  if (capability === "VIEW") {
    // Clearing the base capability clears what it implies.
    let changed = false;
    for (const candidate of CAPABILITIES) {
      if (!groupGrants[candidate].includes(groupId)) continue;
      groupGrants[candidate] = groupGrants[candidate].filter(
        (id) => id !== groupId,
      );
      changed = true;
    }
    return changed ? { ...access, groupGrants } : access;
  }
  if (!groupGrants[capability].includes(groupId)) return access;
  groupGrants[capability] = groupGrants[capability].filter(
    (id) => id !== groupId,
  );
  return { ...access, groupGrants };
}

function accessSignature(access: ItemAccess): string {
  const grants = CAPABILITIES.map(
    (capability) =>
      `${capability}:${[...access.grants[capability]].sort().join(",")}`,
  ).join("\u0001");
  const groupGrants = CAPABILITIES.map(
    (capability) =>
      `${capability}:${[...(access.groupGrants?.[capability] ?? [])].sort((a, b) => a - b).join(",")}`,
  ).join("\u0002");
  const ownerUsers = [...(access.ownerUsers ?? [])].sort().join(",");
  const ownerGroups = [...(access.ownerGroups ?? [])]
    .sort((a, b) => a - b)
    .join(",");
  return [
    crownKey(access.crown),
    access.ownerMissing,
    grants,
    groupGrants,
    ownerUsers,
    ownerGroups,
  ].join("\u0000");
}

/** The group half of an edit — carried beside the user half on the same target. */
export type GroupDraftTarget = Pick<
  AccessTarget,
  "groupGrants" | "ownerGroups"
>;

export interface AccessDraft {
  readonly crown: Crown | null;
  readonly ownerMissing: boolean;
  readonly grants: Readonly<Record<Capability, readonly string[]>>;
  readonly groupGrants: Readonly<Record<Capability, readonly number[]>>;
  readonly ownerUsers: readonly string[];
  readonly ownerGroups: readonly number[];
  readonly dirty: boolean;
  readonly target: AccessTarget & GroupDraftTarget;
  readonly setOwner: (crown: Crown) => void;
  readonly grant: (capability: Capability, username: string) => void;
  readonly revoke: (capability: Capability, username: string) => void;
  readonly grantGroup: (capability: Capability, groupId: number) => void;
  readonly revokeGroup: (capability: Capability, groupId: number) => void;
  readonly addOwnerUser: (username: string) => void;
  readonly removeOwnerUser: (username: string) => void;
  readonly addOwnerGroup: (groupId: number) => void;
  readonly removeOwnerGroup: (groupId: number) => void;
}

/**
 * Capability-aware draft. The whole editor reads one `grants` record (and, for
 * groups, one `groupGrants` record) and edits it through the mutators; `target`
 * carries both records so the planner diffs them against the loaded access. The
 * `accessSignature` guard reloads the draft whenever the `access` prop really
 * changes — the signature covers the owner, ownerMissing, all six capability
 * lists, every group's capability list, the owner-user names and the
 * owner-group ids, so an equal prop leaves in-flight edits intact.
 */
export function useAccessDraft(access: ItemAccess): AccessDraft {
  const [draft, setDraft] = useState<ItemAccess>(access);
  const loaded = useRef(accessSignature(access));
  const signature = accessSignature(access);
  if (loaded.current !== signature) {
    loaded.current = signature;
    setDraft(access);
  }

  // The data layer always populates both group records; the guards keep the
  // editor whole against an item read that predates them, never a new shape.
  const groupGrants = draft.groupGrants ?? emptyGroupGrants();
  const ownerUsers = draft.ownerUsers ?? [];
  const ownerGroups = draft.ownerGroups ?? [];

  return {
    crown: draft.crown,
    ownerMissing: draft.ownerMissing,
    grants: draft.grants,
    groupGrants,
    ownerUsers,
    ownerGroups,
    dirty: accessSignature(draft) !== signature,
    target: {
      crown: draft.crown ?? undefined,
      grants: draft.grants,
      groupGrants,
      ownerUsers,
      ownerGroups,
    },
    setOwner: (crown) => setDraft((current) => ({ ...current, crown })),
    grant: (capability, username) =>
      setDraft((current) => grantCapability(current, capability, username)),
    revoke: (capability, username) =>
      setDraft((current) => revokeCapability(current, capability, username)),
    grantGroup: (capability, groupId) =>
      setDraft((current) => grantGroupCapability(current, capability, groupId)),
    revokeGroup: (capability, groupId) =>
      setDraft((current) =>
        revokeGroupCapability(current, capability, groupId),
      ),
    addOwnerUser: (username) =>
      setDraft((current) => {
        const owners = current.ownerUsers ?? [];
        return owners.includes(username)
          ? current
          : { ...current, ownerUsers: [...owners, username] };
      }),
    removeOwnerUser: (username) =>
      setDraft((current) => ({
        ...current,
        ownerUsers: (current.ownerUsers ?? []).filter(
          (name) => name !== username,
        ),
      })),
    addOwnerGroup: (groupId) =>
      setDraft((current) => {
        const groups = current.ownerGroups ?? [];
        return groups.includes(groupId)
          ? current
          : { ...current, ownerGroups: [...groups, groupId] };
      }),
    removeOwnerGroup: (groupId) =>
      setDraft((current) => ({
        ...current,
        ownerGroups: (current.ownerGroups ?? []).filter((id) => id !== groupId),
      })),
  };
}

/* ── the one editor ────────────────────────────────────────────────────
 *
 * Both surfaces (the per-item `AccessPanel` and the settings
 * `ResourceAccessDialog` through `ResourceAccessFields`) render this, so they
 * cannot drift. One owner row with an additive owner set (users and groups),
 * one catalog of users *and* groups in a single list, and one chip row that
 * applies a capability set to the selected cards. The catalog doubles as the
 * selection read-out: a picked card goes green and sorts to the front, so the
 * selection is visible without a second list, and the search box narrows it
 * through the same ranked-suggestion + arrow-key model the owner field uses.
 * The requester owner, every owner row and every grant are independent:
 * editing one never touches another.
 */

const CARD_CLASS =
  "flex flex-col items-center gap-2 rounded-md border border-line bg-surface-2 p-2 text-center transition-colors tab-stop " +
  "hover:border-line-strong hover:bg-surface-3 focus-visible:outline-none";

const CARD_SELECTED_CLASS =
  "data-[granted=true]:border-brand data-[granted=true]:bg-[var(--accent-dim)]";

const CARD_HIGHLIGHT_CLASS =
  "data-[highlighted=true]:ring-2 data-[highlighted=true]:ring-brand";

const OWNER_LIST_ID = "owner-group-options";

const CATALOG_ID = "access-catalog-options";

const CHIP_BASE =
  "inline-flex shrink-0 items-center gap-1.5 h-7 rounded-full border px-3 text-sm font-medium whitespace-nowrap tab-stop " +
  "transition-colors [&:hover:not(:disabled)]:border-line-strong disabled:opacity-45";

const CHIP_ON = "border-brand bg-[var(--accent-dim)] text-ink";
const CHIP_OFF = "border-line bg-surface-2 text-ink-muted";
const CHIP_PARTIAL = "border-brand border-dashed bg-transparent text-ink";

const OVERRIDES_LIST_ID = "access-overrides-options";

/** The crown badge is the warning yellow; a co-owner's is neutral. */
const OWNER_BADGE_CROWN_CLASS =
  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-warning-dim bg-warning-dim px-2.5";

const CO_OWNER_BADGE_CLASS =
  "inline-flex h-8 min-w-0 items-center gap-1 rounded-full border border-line bg-surface-2 pr-1 pl-2.5 focus-within:shadow-ring";

const CO_OWNER_NAME_CLASS =
  "inline-flex min-w-0 items-center gap-1.5 rounded-full tab-stop focus-visible:outline-none disabled:opacity-45";

/** One principal a suggestion list can offer — a sub-set of a `PrincipalCard`. */
export interface SuggestionOption {
  readonly kind: "user" | "group";
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

interface PrincipalSuggestionsProps<Option extends SuggestionOption> {
  readonly id: string;
  readonly label: string;
  readonly open: boolean;
  readonly options: readonly Option[];
  readonly highlight: number;
  /**
   * The picked read-out, for a list that mirrors a selection. Omitted by a
   * single-pick list, where the highlight is the whole state.
   */
  readonly selected?: (option: Option) => boolean;
  readonly onHover: (index: number) => void;
  readonly onPick: (option: Option) => void;
}

/**
 * The floating suggestion list both fields share, so the "Add an owner" field
 * and the overrides search cannot offer principals differently. Always mounted:
 * unmounting it on blur removes a node while focus is in transit, and Radix's
 * focus scope then yanks focus back to the dialog container, which leaves every
 * control after the field unreachable by Tab.
 */
function PrincipalSuggestions<Option extends SuggestionOption>({
  id,
  label,
  open,
  options,
  highlight,
  selected,
  onHover,
  onPick,
}: PrincipalSuggestionsProps<Option>) {
  return (
    <div
      className={cn(
        "absolute top-full right-0 left-0 z-[var(--z-popover)] mt-1 rounded-md border border-line-strong bg-surface-3 p-2 shadow-elev-md",
        open ? "" : "hidden",
      )}
      aria-hidden={open ? undefined : true}
    >
      {options.length === 0 ? null : (
        <ul
          id={id}
          role="listbox"
          aria-label={label}
          className="flex max-h-64 flex-col gap-0.5 overflow-y-auto"
        >
          {options.map((option, index) => {
            const picked =
              selected === undefined ? index === highlight : selected(option);
            return (
              <li
                key={`${option.kind}-${option.id}`}
                id={`${id}-${option.kind}-${option.id}`}
                role="option"
                aria-selected={picked}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-sm",
                  index === highlight
                    ? "bg-[var(--accent-dim)] text-ink"
                    : "text-ink-muted",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(option)}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  {selected !== undefined && picked ? (
                    <IconCheck size={13} className="shrink-0 text-brand" />
                  ) : null}
                  <span className="truncate">{option.label}</span>
                </span>
                <span className="shrink-0 text-2xs text-ink-dim">
                  {option.detail}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface OwnerOption {
  readonly kind: "user" | "group";
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

/** One catalog entry — a user or a group, which the editor treats alike. */
interface PrincipalCard {
  readonly kind: "user" | "group";
  /** The bare username or group id, as the draft mutators take it. */
  readonly id: string;
  /** The selection key, `kind:id`, so a username cannot collide with a group id. */
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly meta: string;
  readonly terms: readonly string[];
}

/** Split a selection key back into the principal it names. */
function splitCardKey(key: string): { kind: "user" | "group"; id: string } {
  if (key.startsWith("group:"))
    return { kind: "group", id: key.slice("group:".length) };
  return { kind: "user", id: key.slice("user:".length) };
}

/** Does the draft hold `capability` for the principal the key names? */
function holdsKey(
  draft: AccessDraft,
  capability: Capability,
  key: string,
): boolean {
  const { kind, id } = splitCardKey(key);
  return kind === "group"
    ? holdsGroupCapability(draft.groupGrants, capability, Number(id))
    : holdsCapability(draft.grants, capability, id);
}

export interface ResourceAccessEditorProps {
  readonly resourceType: string;
  readonly draft: AccessDraft;
  readonly users: readonly User[];
  /** Required: a host that forgets the group list renders an empty Groups tab. */
  readonly groups: readonly AccessGroup[];
  readonly busy?: boolean;
  /** The owner row's label when no owner is picked — a bulk host says so instead. */
  readonly emptyOwnerLabel?: string;
}

export function ResourceAccessEditor({
  resourceType,
  draft,
  users,
  groups,
  busy = false,
  emptyOwnerLabel = "No owner",
}: ResourceAccessEditorProps) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [note, setNote] = useState("");
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [ownerQuery, setOwnerQuery] = useState("");
  const [ownerHighlight, setOwnerHighlight] = useState(0);
  const [overridesOpen, setOverridesOpen] = useState(false);

  const selection = useSelection<string>();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ownerInputRef = useRef<HTMLInputElement | null>(null);

  const removeOwnerAndRefocus = (remove: () => void) => {
    remove();
    ownerInputRef.current?.focus();
  };
  const crownOwnerAndRefocus = (crown: Crown) => {
    crownPrincipal(crown);
    ownerInputRef.current?.focus();
  };
  const marquee = useMarqueeSelection(scrollRef, (keys) =>
    selection.setMany(keys),
  );

  const ownerLabel = crownLabel(draft.crown, users, groups, emptyOwnerLabel);
  /** The crown when a *user* holds it — the additive owner lists filter on it. */
  const crownUsername =
    draft.crown?.kind === "user" ? draft.crown.username : "";

  const groupById = useMemo(() => {
    const map = new Map<number, AccessGroup>();
    for (const group of groups) map.set(group.id, group);
    return map;
  }, [groups]);

  // The crown is rendered by its own badge, so it is never repeated as a co-owner.
  const coOwnerUsers = draft.ownerUsers.filter(
    (username) => username !== crownUsername,
  );
  const coOwnerGroups = draft.ownerGroups.filter(
    (groupId) =>
      draft.crown?.kind !== "group" || draft.crown.groupId !== groupId,
  );

  const ownerUserSet = useMemo(
    () => new Set(draft.ownerUsers),
    [draft.ownerUsers],
  );
  const ownerGroupIdSet = useMemo(
    () => new Set(draft.ownerGroups),
    [draft.ownerGroups],
  );
  const everyoneOwned = draft.ownerGroups.some((id) => {
    const group = groupById.get(id);
    return group !== undefined && isEveryoneGroup(group);
  });

  const ownerOptions = useMemo(() => {
    const options: OwnerOption[] = [
      ...users
        .filter(
          (user) =>
            user.username !== crownUsername && !ownerUserSet.has(user.username),
        )
        .map((user) => ({
          kind: "user" as const,
          id: user.username,
          label: userLabel(user),
          detail: `@${user.username}`,
        })),
      ...groups
        .filter((group) => !ownerGroupIdSet.has(group.id))
        .map((group) => ({
          kind: "group" as const,
          id: String(group.id),
          label: groupLabel(group),
          detail: groupMembersLabel(group),
        })),
    ];
    return rankBySearch(options, ownerQuery, (option) => [
      option.label,
      option.detail,
    ]);
  }, [users, groups, crownUsername, ownerUserSet, ownerGroupIdSet, ownerQuery]);

  const ownerListOpen = ownerOpen && ownerOptions.length > 0;
  const ownerHighlightIndex =
    ownerOptions.length === 0
      ? 0
      : Math.min(ownerHighlight, ownerOptions.length - 1);

  function applyOwnerOption(option: OwnerOption): void {
    if (busy) return;
    if (option.kind === "user") draft.addOwnerUser(option.id);
    else draft.addOwnerGroup(Number(option.id));
    setOwnerQuery("");
    setOwnerHighlight(0);
    setOwnerOpen(false);
  }

  function onOwnerKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (ownerOptions.length === 0) return;
      event.preventDefault();
      setOwnerOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setOwnerHighlight(
        (current) =>
          (current + step + ownerOptions.length) % ownerOptions.length,
      );
    } else if (event.key === "Enter") {
      const option = ownerOptions[ownerHighlightIndex];
      if (option === undefined) return;
      event.preventDefault();
      applyOwnerOption(option);
    } else if (event.key === "Escape") {
      // Escape belongs to the field while it holds focus: clear the query, close
      // the suggestions and drop focus. The dialog stays open — the wrapper's
      // `data-owns-escape` is what tells Dialog to skip the dismiss.
      event.preventDefault();
      setOwnerQuery("");
      setOwnerOpen(false);
      event.currentTarget.blur();
    }
  }

  function crownPrincipal(crown: Crown): void {
    if (busy) return;
    setNote("");
    draft.setOwner(crown);
  }

  // The catalog is one list: users and groups together. Whoever already owns the
  // item is left out — an owner holds every capability implicitly, so a grant row
  // for one would be inert, and the owner row above is where owners are edited.
  const pool = useMemo<PrincipalCard[]>(() => {
    const userCards = users.map((user) => ({
      kind: "user" as const,
      id: user.username,
      key: `user:${user.username}`,
      label: userLabel(user),
      detail: `@${user.username}`,
      meta: "",
      terms: [user.display_name, user.username],
    }));
    const groupCards = groups.map((group) => ({
      kind: "group" as const,
      id: String(group.id),
      key: `group:${group.id}`,
      label: group.name,
      detail: group.display_name,
      meta: groupMembersLabel(group),
      terms: [group.display_name, group.name],
    }));
    return [
      ...userCards.filter(
        (card) => card.id !== crownUsername && !ownerUserSet.has(card.id),
      ),
      ...groupCards.filter((card) => !ownerGroupIdSet.has(Number(card.id))),
    ];
  }, [users, groups, crownUsername, ownerUserSet, ownerGroupIdSet]);

  const matches = useMemo(
    () => rankBySearch(pool, query, (card) => card.terms),
    [pool, query],
  );

  // The catalog is the selection read-out too, so the picked cards lead and keep
  // their ranked order inside each half — `sort` is stable. The order is frozen
  // for the whole of a marquee sweep: reordering under the pointer drags a
  // freshly swept card out of the band (and straight back in), which flickers
  // the selection and fights the edge auto-scroll.
  const leading = useMemo(
    () =>
      [...matches].sort(
        (a, b) =>
          Number(selection.selected.has(b.key)) -
          Number(selection.selected.has(a.key)),
      ),
    [matches, selection.selected],
  );
  const orderRef = useRef<readonly PrincipalCard[]>([]);
  const sweeping = marquee.overlay !== null;
  if (!sweeping) orderRef.current = leading;
  const cards = sweeping ? orderRef.current : leading;

  const highlighted =
    cards.length === 0 ? 0 : Math.min(highlight, cards.length - 1);

  // A picked principal stays picked while the search hides it, so the count and
  // the chip row read the whole pool, not the filtered list.
  const selectedKeys = useMemo(
    () =>
      pool
        .filter((card) => selection.selected.has(card.key))
        .map((card) => card.key),
    [pool, selection.selected],
  );

  function isPicked(card: PrincipalCard): boolean {
    return selection.selected.has(card.key);
  }

  function pickCard(card: PrincipalCard): void {
    if (busy) return;
    selection.toggle(card.key);
  }

  function onCatalogKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (cards.length === 0) return;
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight(
        (current) =>
          (Math.min(current, cards.length - 1) + step + cards.length) %
          cards.length,
      );
    } else if (event.key === "Enter") {
      const card = cards[highlighted];
      if (card === undefined) return;
      event.preventDefault();
      pickCard(card);
    } else if (event.key === "Escape") {
      // Escape belongs to the field while it holds focus: empty it and drop
      // focus. The panel stays open — the wrapper's `data-owns-escape` is what
      // tells Dialog to skip the dismiss.
      event.preventDefault();
      setQuery("");
      setHighlight(0);
      setOverridesOpen(false);
      event.currentTarget.blur();
    }
  }

  /**
   * The catalog is one roving stop: Tab lands on the highlighted card and the
   * arrows move between cards, so a list of fifty principals costs one Tab
   * press rather than fifty. `Home`/`End` jump to the ends.
   */
  function onCardKeyDown(
    event: KeyboardEvent<HTMLDivElement>,
    card: PrincipalCard,
    index: number,
  ): void {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      pickCard(card);
      return;
    }
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const backward = event.key === "ArrowUp" || event.key === "ArrowLeft";
    if (!forward && !backward && event.key !== "Home" && event.key !== "End")
      return;
    if (cards.length === 0) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? cards.length - 1
          : (Math.min(index, cards.length - 1) +
              (forward ? 1 : -1) +
              cards.length) %
            cards.length;
    setHighlight(next);
    const target = cards[next];
    if (target === undefined) return;
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-marquee-key="${target.key}"]`)
      ?.focus();
  }

  const offered = offeredCapabilities(resourceType);
  // A grant for a capability this type no longer offers predates the type
  // filter, so it still gets a chip (dashed) — otherwise it could never be
  // cleared. Both records count, so a group's retired grant stays reachable.
  const legacy = CAPABILITIES.filter(
    (capability) =>
      !offered.includes(capability) &&
      (draft.grants[capability].length > 0 ||
        (draft.groupGrants[capability] ?? []).length > 0),
  );

  function selectionState(capability: Capability): "all" | "partial" | "none" {
    if (selectedKeys.length === 0) return "none";
    const holding = selectedKeys.filter((key) =>
      holdsKey(draft, capability, key),
    ).length;
    if (holding === 0) return "none";
    return holding === selectedKeys.length ? "all" : "partial";
  }

  function clearSelection(): void {
    selection.clear();
    setNote("");
  }

  function toggleCapability(capability: Capability): void {
    const turnOn = selectionState(capability) !== "all";
    if (!turnOn && capability === "VIEW") {
      const losesMore = selectedKeys.some((key) =>
        CAPABILITIES.some(
          (candidate) =>
            candidate !== "VIEW" && holdsKey(draft, candidate, key),
        ),
      );
      setNote(
        losesMore
          ? "Clearing View access also clears every other capability."
          : "",
      );
    } else {
      setNote("");
    }
    for (const key of selectedKeys) {
      const { kind, id } = splitCardKey(key);
      if (kind === "group") {
        const groupId = Number(id);
        if (turnOn) draft.grantGroup(capability, groupId);
        else draft.revokeGroup(capability, groupId);
      } else if (turnOn) {
        draft.grant(capability, id);
      } else {
        draft.revoke(capability, id);
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-md border border-line-subtle bg-surface-1 px-2.5 py-1.5">
        <div className="flex flex-wrap items-start gap-x-2">
          <span className="text-2xs uppercase tracking-wide text-ink-dim">
            Ownership
          </span>
          {everyoneOwned ? (
            <span
              role="alert"
              className="flex min-w-0 flex-1 items-start gap-1.5 text-xs font-medium text-danger"
            >
              <IconAlert size={14} className="mt-px shrink-0" />
              <span className="min-w-0">{EVERYONE_OWNER_WARNING}</span>
            </span>
          ) : (
            <span className="text-xs text-ink-dim">
              Owners get every permission on this item.
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span data-testid="owner-crown" className={OWNER_BADGE_CROWN_CLASS}>
            <IconCrown size={16} className="shrink-0 text-warning" />
            <Avatar name={ownerLabel} small />
            <span className="truncate text-sm">{ownerLabel}</span>
            {draft.crown !== null && draft.ownerMissing ? (
              <span className="shrink-0 text-2xs text-danger">missing</span>
            ) : null}
          </span>
          {coOwnerUsers.map((username) => (
            <span key={username} className={CO_OWNER_BADGE_CLASS}>
              <button
                type="button"
                disabled={busy}
                aria-label={`Make ${usernameLabel(users, username)} the owner`}
                aria-keyshortcuts="Backspace"
                onClick={() => crownOwnerAndRefocus({ kind: "user", username })}
                onKeyDown={(event) => {
                  if (event.key !== "Backspace") return;
                  event.preventDefault();
                  removeOwnerAndRefocus(() => draft.removeOwnerUser(username));
                }}
                className={CO_OWNER_NAME_CLASS}
              >
                <IconUser size={14} className="shrink-0 text-ink-dim" />
                <span className="max-w-[12rem] truncate text-sm">
                  {usernameLabel(users, username)}
                </span>
              </button>
              <IconButton
                label={`Remove owner ${username}`}
                icon={<IconX size={14} />}
                size="sm"
                className="tab-skip"
                disabled={busy}
                onClick={() =>
                  removeOwnerAndRefocus(() => draft.removeOwnerUser(username))
                }
              />
            </span>
          ))}
          {coOwnerGroups.map((groupId) => {
            const group = groupById.get(groupId);
            const label =
              group === undefined ? `#${groupId}` : groupLabel(group);
            return (
              <span key={groupId} className={CO_OWNER_BADGE_CLASS}>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Make ${label} the owner`}
                  aria-keyshortcuts="Backspace"
                  onClick={() => crownOwnerAndRefocus({ kind: "group", groupId })}
                  onKeyDown={(event) => {
                    if (event.key !== "Backspace") return;
                    event.preventDefault();
                    removeOwnerAndRefocus(() =>
                      draft.removeOwnerGroup(groupId),
                    );
                  }}
                  className={CO_OWNER_NAME_CLASS}
                >
                  <IconUser size={14} className="shrink-0 text-ink-dim" />
                  <span className="max-w-[12rem] truncate text-sm">
                    {label}
                  </span>
                </button>
                <IconButton
                  label={`Remove owner group ${label}`}
                  icon={<IconX size={14} />}
                  size="sm"
                  className="tab-skip"
                  disabled={busy}
                  onClick={() =>
                    removeOwnerAndRefocus(() => draft.removeOwnerGroup(groupId))
                  }
                />
              </span>
            );
          })}
        </div>

        <div className="relative min-w-[200px]" data-owns-escape>
          <Input
            ref={ownerInputRef}
            type="search"
            autoComplete="off"
            value={ownerQuery}
            placeholder="Add a user or group as owner…"
            aria-label="Add an owner"
            role="combobox"
            aria-expanded={ownerListOpen}
            aria-controls={ownerListOpen ? OWNER_LIST_ID : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              ownerListOpen
                ? `${OWNER_LIST_ID}-${ownerOptions[ownerHighlightIndex].kind}-${ownerOptions[ownerHighlightIndex].id}`
                : undefined
            }
            disabled={busy}
            onChange={(event) => {
              setOwnerQuery(event.target.value);
              setOwnerOpen(true);
              setOwnerHighlight(0);
            }}
            onFocus={() => setOwnerOpen(true)}
            onBlur={() => setOwnerOpen(false)}
            onKeyDown={onOwnerKeyDown}
          />

          <PrincipalSuggestions
            id={OWNER_LIST_ID}
            label="Users and groups to own this item"
            open={ownerListOpen}
            options={ownerOptions}
            highlight={ownerHighlightIndex}
            onHover={setOwnerHighlight}
            onPick={applyOwnerOption}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-line-subtle pt-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xs uppercase tracking-wide text-ink-dim">
            Permission overrides
          </span>
          <span className="text-xs text-ink-dim">
            Overrides are more specific — they grant only the capabilities you
            pick.
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1" data-owns-escape>
          <span
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-ink-dim"
            aria-hidden="true"
          >
            <IconSearch size={16} />
          </span>
          <Input
            type="search"
            autoComplete="off"
            className="pl-9"
            value={query}
            placeholder="Search users and groups…"
            aria-label="Search users and groups"
            role="combobox"
            aria-expanded={overridesOpen && cards.length > 0}
            aria-controls={overridesOpen ? OVERRIDES_LIST_ID : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              cards.length === 0 || !overridesOpen
                ? undefined
                : `${OVERRIDES_LIST_ID}-${cards[highlighted].kind}-${cards[highlighted].id}`
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
              setOverridesOpen(true);
            }}
            onFocus={() => setOverridesOpen(true)}
            onBlur={() => setOverridesOpen(false)}
            onKeyDown={onCatalogKeyDown}
          />
          <PrincipalSuggestions
            id={OVERRIDES_LIST_ID}
            label="Matching users and groups"
            open={overridesOpen && cards.length > 0}
            options={cards}
            highlight={highlighted}
            selected={isPicked}
            onHover={setHighlight}
            onPick={pickCard}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || cards.length === 0}
          onClick={() => selection.setMany(cards.map((card) => card.key))}
        >
          Select all
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || selectedKeys.length === 0}
          onClick={clearSelection}
        >
          Clear
        </Button>
      </div>

      <div
        ref={scrollRef}
        id={CATALOG_ID}
        role="listbox"
        aria-label="Users and groups"
        aria-multiselectable={true}
        data-testid="access-catalog"
        className="relative max-h-[calc(100dvh-520px)] min-h-[120px] flex-1 overflow-y-auto rounded-md border border-line-subtle bg-surface-1 p-2 select-none touch-pan-y"
      >
        {cards.length === 0 ? (
          <p className="p-2 text-sm text-ink-muted">
            No users or groups match.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {cards.map((card, index) => {
              const picked = isPicked(card);
              return (
                <div
                  key={card.key}
                  id={`${CATALOG_ID}-${card.kind}-${card.id}`}
                  role="option"
                  aria-selected={picked}
                  aria-disabled={busy ? true : undefined}
                  tabIndex={index === highlighted ? 0 : -1}
                  data-marquee-key={card.key}
                  data-granted={picked}
                  data-highlighted={index === highlighted}
                  onClick={() => pickCard(card)}
                  onFocus={() => setHighlight(index)}
                  onMouseEnter={() => setHighlight(index)}
                  onKeyDown={(event) => onCardKeyDown(event, card, index)}
                  className={cn(
                    CARD_CLASS,
                    "cursor-pointer",
                    picked && CARD_SELECTED_CLASS,
                    index === highlighted && CARD_HIGHLIGHT_CLASS,
                    busy && "opacity-45",
                  )}
                >
                  {card.kind === "user" ? <Avatar name={card.label} /> : null}
                  <span className="w-full truncate text-sm">{card.label}</span>
                  <span
                    className={cn(
                      "w-full truncate text-2xs text-ink-dim",
                      card.kind === "user" && "[font-family:var(--font-mono)]",
                    )}
                  >
                    {card.detail}
                  </span>
                  {card.kind === "group" ? (
                    <span className="w-full truncate text-2xs text-ink-muted">
                      {card.meta}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {marquee.overlay === null ? null : (
          <div
            className="pointer-events-none absolute rounded-xs border border-brand bg-[var(--accent-dim)]"
            style={{
              left: marquee.overlay.left,
              top: marquee.overlay.top,
              width: marquee.overlay.width,
              height: marquee.overlay.height,
            }}
            aria-hidden="true"
          />
        )}
      </div>

      <div
        className="flex items-center justify-between gap-2 text-sm"
        aria-live="polite"
      >
        <span className="text-ink-muted">{`${selectedKeys.length} selected`}</span>
        {note === "" ? null : <span className="text-warning">{note}</span>}
      </div>
      <div
        role="group"
        aria-label="Capabilities for the selected users and groups"
        className="flex flex-wrap items-center gap-2"
      >
        {[...offered, ...legacy].map((capability) => {
          const state = selectionState(capability);
          const retired = !offered.includes(capability);
          return (
            <button
              key={capability}
              type="button"
              aria-pressed={
                state === "all" ? true : state === "partial" ? "mixed" : false
              }
              disabled={busy || selectedKeys.length === 0}
              title={
                retired
                  ? "Not offered for this item type — clear it here."
                  : undefined
              }
              className={cn(
                CHIP_BASE,
                state === "all"
                  ? CHIP_ON
                  : state === "partial"
                    ? CHIP_PARTIAL
                    : CHIP_OFF,
                retired && "border-dashed",
              )}
              onClick={() => toggleCapability(capability)}
            >
              {state === "all" ? <IconCheck size={14} /> : null}
              {capabilityLabel(capability)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface ResourceAccessFieldsProps {
  readonly resourceType: string;
  readonly access: ItemAccess;
  readonly users: readonly User[];
  readonly groups: readonly AccessGroup[];
  readonly busy?: boolean;
  readonly onApply: (target: AccessTarget & GroupDraftTarget) => void;
  readonly applyLabel?: string;
}

/**
 * The settings-dialog body: the shared editor plus its inline status/apply
 * footer. `AccessPanel` renders the same editor and pins the equivalent footer
 * in its `Dialog` footer instead.
 */
export function ResourceAccessFields({
  resourceType,
  access,
  users,
  groups,
  busy = false,
  onApply,
  applyLabel = "Apply changes",
}: ResourceAccessFieldsProps) {
  const draft = useAccessDraft(access);
  return (
    <div className="flex flex-col gap-4">
      <ResourceAccessEditor
        resourceType={resourceType}
        draft={draft}
        users={users}
        groups={groups}
        busy={busy}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-muted">
          {draft.dirty ? "Unsaved changes" : "Up to date"}
        </span>
        <Button
          size="sm"
          variant="primary"
          loading={busy}
          disabled={!draft.dirty || busy}
          onClick={() => onApply(draft.target)}
        >
          {applyLabel}
        </Button>
      </div>
    </div>
  );
}
