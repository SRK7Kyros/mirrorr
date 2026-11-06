import {
  BADGE_LABELS,
  itemBadge,
  issueKind,
  issueOriginHash,
  suggestedRename,
  type ImportItem,
  type ImportValidateReport,
  type ItemBadge,
} from "@/api"
import {
  Badge,
  Banner,
  Checkbox,
  Hash,
  StatLine,
  Table,
  Tag,
  Td,
  Th,
} from "@/ui/components"
import { pluralize } from "@/ui/lib/format"
import { CollisionChoice } from "./collision-choice"
import {
  collisionOf,
  countByKind,
  itemKey,
  needsResolution,
  selectedCount,
  selectionLabel,
  type Collision,
  type CollisionMode,
  type ImportResolution,
  type ImportResolutions,
} from "./import-logic"
import { ResolutionControls, type LookupOption } from "./resolution-controls"

const BADGE_VARIANT: Record<ItemBadge, "accent" | "neutral" | "danger"> = {
  ready: "accent",
  skip: "neutral",
  "needs-mapping": "neutral",
  conflict: "danger",
}

export interface ImportPreviewProps {
  readonly report: ImportValidateReport
  readonly resolutions: ImportResolutions
  readonly pastNames: readonly string[]
  readonly engines: readonly LookupOption[]
  readonly resolvers: readonly LookupOption[]
  readonly profiles: readonly LookupOption[]
  readonly onResolution: (item: ImportItem, patch: Partial<ImportResolution>) => void
  readonly onCollision: (item: ImportItem, mode: CollisionMode) => void
  readonly onSelectAll: (included: boolean) => void
}

interface ItemProps {
  readonly item: ImportItem
  readonly resolution: ImportResolution
  readonly engines: readonly LookupOption[]
  readonly resolvers: readonly LookupOption[]
  readonly profiles: readonly LookupOption[]
  readonly onResolution: (item: ImportItem, patch: Partial<ImportResolution>) => void
  readonly onCollision: (item: ImportItem, mode: CollisionMode) => void
}

/** The bundle's own complaints, minus the collision the row controls settle. */
function IssueList({ item }: { readonly item: ImportItem }) {
  const issues = item.issues.filter((issue) => issueKind(issue) !== "name_conflict")
  if (issues.length === 0) return <span className="text-dim">No issues</span>
  return (
    <div className="flex flex-col gap-2">
      {issues.map((issue, index) => {
        const hash = issueOriginHash(issue)
        return (
          <span
            key={`${issue.type}-${index}`}
            className="flex items-center gap-3"
            style={{ gap: "var(--s-2)" }}
          >
            <Tag>{issueKind(issue)}</Tag>
            {hash !== null ? <Hash value={hash} label={`${item.name} origin hash`} /> : null}
          </span>
        )
      })}
    </div>
  )
}

/** Everything the row asks of the user: settle the clash, then map what is missing. */
function ItemDecisions({
  item,
  resolution,
  collision,
  engines,
  resolvers,
  profiles,
  onResolution,
  onCollision,
  compact = false,
}: ItemProps & { readonly collision: Collision | null; readonly compact?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {collision !== null && resolution.collision !== undefined ? (
        <CollisionChoice
          bundledName={item.name}
          collision={collision}
          mode={resolution.collision}
          onChange={(mode) => onCollision(item, mode)}
        />
      ) : null}
      <ResolutionControls
        item={item}
        resolution={resolution}
        engines={engines}
        resolvers={resolvers}
        profiles={profiles}
        onChange={(patch) => onResolution(item, patch)}
        empty={compact || collision !== null ? "none" : "dash"}
      />
    </div>
  )
}

/** The bundled name, plus the server's rename when one is already decided. */
function ItemName({ item }: { readonly item: ImportItem }) {
  const rename = suggestedRename(item)
  return (
    <div className="flex flex-col gap-1">
      <span>{item.name}</span>
      {rename !== null ? <span className="text-dim">{`→ ${rename}`}</span> : null}
    </div>
  )
}

function RenameNote({ item }: { readonly item: ImportItem }) {
  const rename = suggestedRename(item)
  return rename === null ? null : <span className="text-dim">{`→ ${rename}`}</span>
}

function ItemCheckbox({ item, resolution, onResolution }: ItemProps) {
  return (
    <Checkbox
      aria-label={`Include ${item.name}`}
      checked={resolution.included}
      onChange={(event) => onResolution(item, { included: event.target.checked })}
    />
  )
}

function ItemCard(props: ItemProps) {
  const badge = itemBadge(props.item)
  const collision = collisionOf(props.item)
  return (
    <li
      data-included={props.resolution.included}
      className="flex items-start gap-2 rounded-md border border-line bg-surface-2 p-3"
    >
      <span className="flex h-6 items-center">
        <ItemCheckbox {...props} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-md font-semibold text-ink [overflow-wrap:anywhere]">
            {props.item.name}
          </span>
          <Tag>{props.item.kind}</Tag>
          <Badge variant={BADGE_VARIANT[badge]}>{BADGE_LABELS[badge]}</Badge>
        </div>
        <RenameNote item={props.item} />
        {props.item.issues.filter((issue) => issueKind(issue) !== "name_conflict").length > 0 ? (
          <IssueList item={props.item} />
        ) : null}
        {collision !== null || needsResolution(props.item) ? (
          <ItemDecisions {...props} collision={collision} compact />
        ) : null}
      </div>
    </li>
  )
}

/**
 * The preview step: what the bundle holds, what is selected, and the only two
 * decisions a bundle can force (a plugin to map, a name clash to settle). It
 * never applies anything — the footer in the wizard does that.
 *
 * Both a table and row-cards are rendered because a six-column table clips its
 * Resolution column below 672 px, which is where the collision choice lives.
 */
export function ImportPreview({
  report,
  resolutions,
  pastNames,
  engines,
  resolvers,
  profiles,
  onResolution,
  onCollision,
  onSelectAll,
}: ImportPreviewProps) {
  const items = report.items
  const counts = countByKind(items)
  const selected = selectedCount(items, resolutions)
  const allSelected = items.length > 0 && selected === items.length

  if (items.length === 0) {
    return (
      <div className="rounded-md border border-line-subtle bg-surface-2 px-3 py-2 text-sm text-ink-muted">
        This bundle contains no profiles or autoruns, so there is nothing to select.
      </div>
    )
  }

  const shared = { engines, resolvers, profiles, onResolution, onCollision }

  return (
    <div className="flex flex-col gap-4">
      <StatLine
        label="Bundle contents"
        items={[
          pluralize(counts.profiles, "profile"),
          pluralize(counts.autoruns, "autorun"),
          selectionLabel(items, resolutions),
        ]}
      />

      {pastNames.length > 0 ? (
        <Banner
          kind="warning"
          title={`${pluralize(pastNames.length, "item has", "items have")} already started and will be skipped`}
        >
          {`Discarded on import: ${pastNames.join(", ")}.`}
        </Banner>
      ) : null}

      <Checkbox
        label="Select all"
        checked={allSelected}
        indeterminate={selected > 0 && !allSelected}
        onChange={(event) => onSelectAll(event.target.checked)}
      />

      <div className="hidden min-[672px]:block">
        <Table>
          <thead>
            <tr>
              <Th className="cell-check" />
              <Th>Name</Th>
              <Th>Kind</Th>
              <Th>Status</Th>
              <Th>Issues</Th>
              <Th>Resolution</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const key = itemKey(item)
              const resolution: ImportResolution = resolutions[key] ?? { included: false }
              const badge = itemBadge(item)
              const collision = collisionOf(item)
              return (
                <tr key={key} data-included={resolution.included}>
                  <Td>
                    <ItemCheckbox item={item} resolution={resolution} {...shared} />
                  </Td>
                  <Td>
                    <ItemName item={item} />
                  </Td>
                  <Td>
                    <Tag>{item.kind}</Tag>
                  </Td>
                  <Td>
                    <Badge variant={BADGE_VARIANT[badge]}>{BADGE_LABELS[badge]}</Badge>
                  </Td>
                  <Td>
                    <IssueList item={item} />
                  </Td>
                  <Td>
                    <ItemDecisions
                      item={item}
                      resolution={resolution}
                      collision={collision}
                      {...shared}
                    />
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      </div>

      <ul className="flex flex-col gap-2 min-[672px]:hidden">
        {items.map((item) => (
          <ItemCard
            key={itemKey(item)}
            item={item}
            resolution={resolutions[itemKey(item)] ?? { included: false }}
            {...shared}
          />
        ))}
      </ul>
    </div>
  )
}
