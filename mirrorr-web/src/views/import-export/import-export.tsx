import { useMemo, useRef, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { Chip } from "@/components/ui/Chip"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Select } from "@/components/ui/Select"
import { Skeleton } from "@/components/ui/Skeleton"
import { useToast } from "@/components/ui/Toast"
import { LOOKUP_PAGE_SIZE, queryKeys, queryRoots, staleTimes } from "@/lib/query-keys"
import type { Engine, Resolver } from "@/lib/schemas"
import {
  applyImport,
  apiErrorMessage,
  fetchAllEngines,
  fetchAllResolvers,
  fetchProfileExport,
  normalizeValidateReport,
  validateBundle,
  type ApplyBody,
  type ImportApplySummary,
  type ImportItem,
} from "@/views/shared/api"
import { useProfiles } from "@/views/shared/hooks"
import {
  BUNDLE_ITEM_LIMIT,
  buildApplyBody,
  countBundleItems,
  isSupportedVersion,
  issueKind,
  issueOriginHash,
  issuePluginType,
  itemBadge,
  suggestedRename,
  type ItemResolution,
} from "./bundle"
import "@/styles/views-admin.css"

export type WizardStep = 0 | 1 | 2 | 3 | 4
export const WIZARD_STEPS = ["Choose file", "Validation report", "Resolve", "Apply", "Summary"] as const

const UNSUPPORTED_VERSION = "Unsupported bundle version — this console reads version 1 bundles."
const UNREADABLE_FILE = "That file is not valid JSON — drop a mirrorr bundle."

/** Steps 1–3 can move back: their input (file, report, resolutions) is editable. */
export function canGoBack(step: WizardStep): boolean {
  return step === 1 || step === 2 || step === 3
}

/** Resolution state is keyed by item name (bundle entries carry names). */
export type Resolutions = Record<string, ItemResolution>

function StepTabs({ step }: { step: WizardStep }) {
  return (
    <nav className="wiz-stepper chrome-dark" aria-label="Import steps">
      {WIZARD_STEPS.map((label, index) => {
        const state = index === step ? "active" : index < step ? "done" : "todo"
        const cls =
          state === "active" ? "wiz-step wiz-step--active" : state === "done" ? "wiz-step wiz-step--done" : "wiz-step"
        return (
          <span key={label} className={cls} aria-current={index === step ? "step" : undefined}>
            <span className="wiz-step__index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="t-label-caps">{label}</span>
          </span>
        )
      })}
    </nav>
  )
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message !== "") return error.message
  return fallback
}

/* ── export half ───────────────────────────────────────────────────────── */
function ExportPanel({ onImport }: { onImport: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const profiles = useProfiles()
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set())
  const [busy, setBusy] = useState(false)

  const exportOne = (id: number, name: string): void => {
    void fetchProfileExport(id)
      .then((bundle) => downloadBundle(bundle, name))
      .catch((error: unknown) => toast.toast({ kind: "error", title: getErrorMessage(error, "Export failed") }))
  }

  const exportSelected = async (): Promise<void> => {
    if (selected.size === 0) return
    setBusy(true)
    try {
      const ids = [...selected]
      const chosen = profiles.filter((profile) => ids.includes(profile.id))
      const bundles = await Promise.all(chosen.map((profile) => fetchProfileExport(profile.id)))
      downloadBundle(mergeBundles(bundles), "selected")
      toast.toast({ kind: "success", title: `Exported ${ids.length} profile${ids.length === 1 ? "" : "s"}` })
    } catch (error) {
      toast.toast({ kind: "error", title: getErrorMessage(error, "Export failed") })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wiz-body">
      <div className="adm-head">
        <div className="adm-stack">
          <h2 className="t-h3">Export</h2>
          <p className="t-body adm-muted adm-measure">
            Bundles carry profiles and scheduled recordings — never media.
          </p>
        </div>
        <div className="wiz-actions">
          <Button variant="primary" loading={busy} disabled={selected.size === 0} onClick={() => void exportSelected()}>
            Export selected
          </Button>
          <Button variant="secondary" onClick={onImport}>
            Import a bundle
          </Button>
        </div>
      </div>
      {profiles.length === 0 ? (
        <div className="panel opaque adm-panel">
          <EmptyState
            eyebrow="Export"
            headline="No profiles to export."
            body="A profile saves engine, resolver and retry policy for reuse."
            action={
              <Button variant="secondary" onClick={() => void navigate({ to: "/profiles" })}>
                Open profiles
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="wiz-group">
          {profiles.map((profile) => (
            <li
              key={profile.id}
              className="wiz-item"
              data-state="valid"
              data-included={selected.has(profile.id) ? "true" : "false"}
            >
              <div className="wiz-item__head">
                <span className="t-body-strong">{profile.name}</span>
                <div className="wiz-actions">
                  <Chip
                    selected={selected.has(profile.id)}
                    onClick={() =>
                      setSelected((current) => {
                        const next = new Set(current)
                        if (next.has(profile.id)) next.delete(profile.id)
                        else next.add(profile.id)
                        return next
                      })
                    }
                  >
                    {selected.has(profile.id) ? "Selected" : "Select"}
                  </Chip>
                  <Button variant="secondary" onClick={() => exportOne(profile.id, profile.name)}>
                    Export
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function mergeBundles(bundles: readonly unknown[]): unknown {
  const profiles: unknown[] = []
  const autoruns: unknown[] = []
  for (const bundle of bundles) {
    if (typeof bundle !== "object" || bundle === null) continue
    const shape = bundle as { profiles?: unknown; autoruns?: unknown }
    if (Array.isArray(shape.profiles)) profiles.push(...shape.profiles)
    if (Array.isArray(shape.autoruns)) autoruns.push(...shape.autoruns)
  }
  return { version: 1, profiles, autoruns }
}

function downloadBundle(bundle: unknown, label: string): void {
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `mirrorr-bundle-${label}-${stamp}.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/* ── step 1: choose a file ─────────────────────────────────────────────── */
function ChooseStep({
  onFile,
  onBack,
  error,
}: {
  onFile: (text: string) => void
  onBack: () => void
  error: string | null
}) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const read = (file: File): void => {
    void file.text().then((text) => onFile(text))
  }

  return (
    <div className="wiz-body">
      {error !== null ? <ErrorPanel title={error} /> : null}
      <div
        className="wiz-drop"
        data-over={over || undefined}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          const file = event.dataTransfer.files.item(0)
          if (file !== null) read(file)
        }}
      >
        <p className="t-body-strong">Drop a bundle (.json)</p>
        <p className="t-body adm-muted adm-measure">
          Bundles carry profiles and scheduled recordings — never media.
        </p>
        <Button variant="secondary" onClick={() => inputRef.current?.click()}>
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="visually-hidden"
          aria-label="Bundle file"
          onChange={(event) => {
            const file = event.target.files?.item(0)
            if (file !== null && file !== undefined) read(file)
          }}
        />
      </div>
      <div className="wiz-actions">
        <Button variant="ghost" onClick={onBack}>
          Back to export
        </Button>
      </div>
    </div>
  )
}

/* ── step 2: validation report ─────────────────────────────────────────── */
type ItemState = "valid" | "warning" | "error"

function itemState(item: ImportItem): ItemState {
  const kinds = item.issues.map(issueKind)
  if (kinds.includes("profile_missing") || kinds.includes("other")) return "error"
  if (kinds.length > 0) return "warning"
  return item.status === "already_imported" || item.status === "skip" ? "warning" : "valid"
}

function IssueList({ item }: { item: ImportItem }) {
  return (
    <ul className="wiz-issues">
      {item.issues.map((issue, index) => {
        const kind = issueKind(issue)
        const rename = kind === "name_conflict" ? suggestedRename(item) : null
        return (
          <li className="wiz-issue" key={`${issue.type}-${index}`}>
            <span className="t-label-caps adm-muted">{issue.type}</span>
            <span className="t-body">{rename !== null ? `name conflict → "${rename}"` : describeIssue(kind)}</span>
          </li>
        )
      })}
    </ul>
  )
}

function describeIssue(kind: ReturnType<typeof issueKind>): string {
  switch (kind) {
    case "not_installed":
      return "plugin not installed"
    case "hash_mismatch":
      return "hash differs from the installed plugin"
    case "name_conflict":
      return "name conflict"
    case "profile_missing":
      return "profile missing"
    case "engine_override":
      return "engine override"
    default:
      return "unrecognized issue"
  }
}

function ReportStep({
  items,
  onBack,
  onNext,
}: {
  items: readonly ImportItem[]
  onBack: () => void
  onNext: () => void
}) {
  const groups = useMemo(() => {
    const buckets: Record<ItemState, ImportItem[]> = { valid: [], warning: [], error: [] }
    for (const item of items) buckets[itemState(item)].push(item)
    return buckets
  }, [items])

  const renderGroup = (state: ItemState, label: string) => {
    const rows = groups[state]
    if (rows.length === 0) return null
    return (
      <section className="wiz-group" key={state}>
        <div className="wiz-group__head">
          <span className="t-label-caps">{`${label} — ${rows.length}`}</span>
        </div>
        {rows.map((item) => (
          <article className="wiz-item" data-state={state} key={`${item.kind}:${item.name}`}>
            <div className="wiz-item__head">
              <span className="t-body-strong">{item.name}</span>
              <span className="t-label-caps adm-muted">{item.kind}</span>
            </div>
            {item.issues.length === 0 ? (
              <p className="t-body adm-muted">No issues.</p>
            ) : (
              <IssueList item={item} />
            )}
          </article>
        ))}
      </section>
    )
  }

  return (
    <div className="wiz-body">
      <div className="adm-head">
        <h2 className="t-h3">
          {items.length} item{items.length === 1 ? "" : "s"} in this bundle
        </h2>
        <span className="t-body adm-muted">
          {`${groups.valid.length} valid · ${groups.warning.length} need a decision · ${groups.error.length} blocked`}
        </span>
      </div>
      <div className="wiz-scroll">
        {items.length === 0 ? (
          <p className="t-body adm-muted">Nothing to import — the bundle is empty.</p>
        ) : (
          <>
            {renderGroup("error", "Error")}
            {renderGroup("warning", "Warning")}
            {renderGroup("valid", "Valid")}
          </>
        )}
      </div>
      <div className="wiz-actions">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Resolve
        </Button>
      </div>
    </div>
  )
}

/* ── step 3: resolve ───────────────────────────────────────────────────── */
function ResolveStep({
  items,
  resolutions,
  setResolutions,
  engines,
  resolvers,
  profiles,
  onBack,
  onNext,
}: {
  items: readonly ImportItem[]
  resolutions: Resolutions
  setResolutions: (next: Resolutions) => void
  engines: readonly Engine[]
  resolvers: readonly Resolver[]
  profiles: readonly { readonly name: string }[]
  onBack: () => void
  onNext: () => void
}) {
  const overLimit = items.length > BUNDLE_ITEM_LIMIT

  const update = (name: string, patch: Partial<ItemResolution>): void => {
    const current = resolutions[name] ?? { included: true }
    setResolutions({ ...resolutions, [name]: { ...current, ...patch } })
  }

  return (
    <div className="wiz-body">
      {overLimit ? (
        <ErrorPanel
          title={`This bundle has ${items.length} items — the server accepts up to ${BUNDLE_ITEM_LIMIT}.`}
          body="Exclude items or split the bundle before applying."
        />
      ) : null}
      <div className="wiz-scroll">
        {items.map((item) => {
          const resolution = resolutions[item.name] ?? { included: true }
          const hashIssue = item.issues.find((issue) => issueOriginHash(issue) !== null)
          const profileMissing = item.issues.some((issue) => issueKind(issue) === "profile_missing")
          const pluginType = hashIssue !== undefined ? issuePluginType(hashIssue) : "engine"
          const options = (pluginType === "engine" ? engines : resolvers).map((entry) => ({
            value: String(entry.id),
            label: entry.name,
          }))
          return (
            <article
              className="wiz-item"
              data-state={itemState(item)}
              data-included={resolution.included ? "true" : "false"}
              key={`${item.kind}:${item.name}`}
            >
              <div className="wiz-item__head">
                <span className="t-body-strong">{item.name}</span>
                <Chip
                  selected={resolution.included}
                  onClick={() => update(item.name, { included: !resolution.included })}
                >
                  {resolution.included ? "Included" : "Excluded"}
                </Chip>
              </div>
              {hashIssue !== undefined ? (
                <div className="wiz-controls">
                  <Select
                    label={`Map ${pluginType} to an installed plugin`}
                    options={options}
                    value={
                      resolution.plugin !== undefined && resolution.plugin.type === pluginType
                        ? String(resolution.plugin.id)
                        : null
                    }
                    placeholder="Choose installed plugin…"
                    helper={`origin_hash ${issueOriginHash(hashIssue)?.slice(0, 12) ?? "unknown"}`}
                    onChange={(value) => {
                      const hash = issueOriginHash(hashIssue)
                      if (hash === null) return
                      update(item.name, {
                        plugin: { type: pluginType, id: Number(value) },
                        pluginHash: hash,
                      })
                    }}
                  />
                </div>
              ) : null}
              {profileMissing ? (
                <div className="wiz-controls">
                  <Select
                    label="Bind to an installed profile"
                    options={profiles.map((profile) => ({ value: profile.name, label: profile.name }))}
                    value={resolution.profile?.mode === "bind" ? resolution.profile.profileName : null}
                    placeholder="Bind to profile…"
                    onChange={(value) => update(item.name, { profile: { mode: "bind", profileName: value } })}
                  />
                  <Button variant="secondary" onClick={() => update(item.name, { profile: { mode: "inline" } })}>
                    Use inline config
                  </Button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
      <div className="wiz-actions">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" onClick={onNext}>
          Review
        </Button>
      </div>
    </div>
  )
}

/* ── step 4: review before apply ───────────────────────────────────────── */
function summarize(items: readonly ImportItem[], resolutions: Resolutions) {
  let included = 0
  let excluded = 0
  let ready = 0
  let unresolved = 0
  const names = new Set<string>()
  for (const item of items) {
    const resolution = resolutions[item.name] ?? { included: true }
    if (!resolution.included) {
      excluded += 1
      continue
    }
    included += 1
    if (itemBadge(item) === "ready" || itemBadge(item) === "skip") ready += 1
    else if (resolution.plugin === undefined && resolution.profile === undefined) unresolved += 1
    if (resolution.profile?.mode === "bind") names.add(resolution.profile.profileName)
  }
  return { included, excluded, ready, unresolved, profileNames: [...names] }
}

function ReviewStep({
  items,
  resolutions,
  onBack,
  onApply,
  applying,
  error,
}: {
  items: readonly ImportItem[]
  resolutions: Resolutions
  onBack: () => void
  onApply: () => void
  applying: boolean
  error: string | null
}) {
  const summary = summarize(items, resolutions)
  return (
    <div className="wiz-body">
      <section className="wiz-review" aria-label="Review">
        <h2 className="t-h3">Ready to apply</h2>
        <p className="t-body">
          {`${summary.included} included · ${summary.excluded} excluded · ${summary.ready} ready · ${summary.unresolved} unresolved`}
        </p>
        {summary.profileNames.length > 0 ? (
          <p className="t-body adm-muted">{`Profiles referenced: ${summary.profileNames.join(", ")}`}</p>
        ) : null}
      </section>
      {error !== null ? (
        <ErrorPanel
          title={error}
          actions={
            <Button variant="secondary" onClick={onApply}>
              Retry
            </Button>
          }
        />
      ) : null}
      <div className="wiz-actions">
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
        <Button variant="primary" loading={applying} onClick={onApply}>
          Apply import
        </Button>
      </div>
    </div>
  )
}

/* ── step 5: summary ───────────────────────────────────────────────────── */
function SummaryStep({ summary, onDone }: { summary: ImportApplySummary | null; onDone: () => void }) {
  return (
    <div className="wiz-body">
      <section className="wiz-review" aria-label="Import summary" role="status">
        <h2 className="t-h3">Import complete</h2>
        {summary === null ? (
          <p className="t-body adm-muted">The server accepted the bundle.</p>
        ) : (
          <p className="t-body">
            {`${summary.profiles_created} profiles created · ${summary.profiles_skipped} skipped · ${summary.autoruns_created} scheduled recordings created.`}
          </p>
        )}
      </section>
      <div className="wiz-actions">
        <Button variant="secondary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

/* ── orchestrator ──────────────────────────────────────────────────────── */
export function ImportExportView() {
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<"export" | "import">("export")
  const [step, setStep] = useState<WizardStep>(0)
  const [bundle, setBundle] = useState<unknown>(null)
  const [items, setItems] = useState<readonly ImportItem[]>([])
  const [resolutions, setResolutions] = useState<Resolutions>({})
  const [fileError, setFileError] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [summary, setSummary] = useState<ImportApplySummary | null>(null)

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
  const profiles = useProfiles()

  const itemCount = countBundleItems(bundle)

  const onFile = async (text: string): Promise<void> => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      setFileError(UNREADABLE_FILE)
      return
    }
    if (!isSupportedVersion(parsed)) {
      setFileError(UNSUPPORTED_VERSION)
      return
    }
    setFileError(null)
    setBundle(parsed)
    setItems([])
    setResolutions({})
    setStep(1)
    try {
      const report = normalizeValidateReport(await validateBundle(parsed))
      setItems(report.items)
      setResolutions({})
    } catch (error) {
      setFileError(apiErrorMessage(error, "Validation failed"))
    }
  }

  const apply = async (): Promise<void> => {
    setApplying(true)
    setApplyError(null)
    try {
      const body: ApplyBody = buildApplyBody(bundle, items, resolutions)
      const result = await applyImport(body)
      setSummary(result)
      setStep(4)
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
    } catch (error) {
      setApplyError(apiErrorMessage(error, "Apply failed"))
    } finally {
      setApplying(false)
    }
  }

  const reset = (): void => {
    setMode("export")
    setStep(0)
    setBundle(null)
    setItems([])
    setResolutions({})
    setFileError(null)
    setApplyError(null)
    setSummary(null)
  }

  if (mode === "export") {
    return (
      <div className="adm-page">
        <header className="adm-head">
          <h1 className="t-h2">Import / Export</h1>
        </header>
        <div className="panel opaque adm-panel">
          <ExportPanel onImport={() => setMode("import")} />
        </div>
      </div>
    )
  }

  const validationsLoading = step === 1 && items.length === 0 && fileError === null

  return (
    <div className="adm-page">
      <header className="adm-head">
        <h1 className="t-h2">Import bundle</h1>
      </header>
      <StepTabs step={step} />
      <div className="panel opaque adm-panel">
        {step === 0 ? (
          <ChooseStep
            onFile={(text) => void onFile(text)}
            onBack={() => setMode("export")}
            error={fileError}
          />
        ) : null}
        {step === 1 ? (
          validationsLoading ? (
            <div className="adm-stack" role="status" aria-label="Validating bundle">
              <Skeleton geometry="row" />
              <Skeleton geometry="row" />
              <Skeleton geometry="row" />
            </div>
          ) : (
            <ReportStep items={items} onBack={() => setStep(0)} onNext={() => setStep(2)} />
          )
        ) : null}
        {step === 2 ? (
          <ResolveStep
            items={items}
            resolutions={resolutions}
            setResolutions={setResolutions}
            engines={enginesQuery.data ?? []}
            resolvers={resolversQuery.data ?? []}
            profiles={profiles}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        ) : null}
        {step === 3 ? (
          <ReviewStep
            items={items}
            resolutions={resolutions}
            onBack={() => setStep(2)}
            onApply={() => void apply()}
            applying={applying}
            error={applyError}
          />
        ) : null}
        {step === 4 ? <SummaryStep summary={summary} onDone={reset} /> : null}
      </div>
      <p className="t-body adm-muted adm-measure">{`This bundle has ${itemCount} items.`}</p>
    </div>
  )
}
