import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  applyImport,
  BADGE_LABELS,
  BUNDLE_ITEM_LIMIT,
  buildApplyBody,
  countBundleItems,
  downloadJson,
  fetchAutorunExport,
  fetchAutorunPage,
  fetchBundleFromUrl,
  fetchProfileExport,
  getErrorMessage,
  isSupportedVersion,
  issueKind,
  issueOriginHash,
  issuePluginType,
  itemBadge,
  pastAutoruns,
  suggestedRename,
  useEngines,
  useEntityList,
  useProfiles,
  useResolvers,
  validateBundle,
  type ApplyBody,
  type ImportApplySummary,
  type ImportItem,
  type ImportValidateReport,
  type ItemBadge,
  type ItemResolution,
} from "@/api"
import { queryKeys, queryRoots } from "@/api/query-keys"
import {
  Badge,
  Banner,
  Button,
  Checkbox,
  EmptyState,
  ErrorPanel,
  Field,
  FilePicker,
  Hash,
  IconDownload,
  Input,
  LoadMore,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  Radio,
  Select,
  SkeletonRows,
  Table,
  Tag,
  Td,
  Textarea,
  Th,
  toast,
} from "@/ui/components"
import { Page } from "@/ui/views/shared/page"

const UNREADABLE_FILE = "That file is not valid JSON — choose a mirrorr bundle."
const UNSUPPORTED_VERSION = "Unsupported bundle version — this console reads version 1 bundles."

const BADGE_VARIANT: Record<ItemBadge, "accent" | "neutral" | "danger"> = {
  ready: "accent",
  skip: "neutral",
  "needs-mapping": "neutral",
  conflict: "danger",
}

/** Resolution state is keyed by item name (bundle entries carry names). */
type Resolutions = Record<string, ItemResolution>

/* ── export half ─────────────────────────────────────────────────────── */

function ExportPanel() {
  const profiles = useProfiles()
  const autoruns = useEntityList({
    queryKey: queryKeys.autoruns(),
    fetchPage: (cursor) => fetchAutorunPage(cursor),
  })
  const [exportingKey, setExportingKey] = useState<string | null>(null)

  const runExport = async (
    key: string,
    filename: string,
    load: () => Promise<unknown>,
    label: string,
  ): Promise<void> => {
    setExportingKey(key)
    try {
      const data = await load()
      if (!downloadJson(filename, data)) {
        toast.error("Export failed", "The file could not be saved.")
        return
      }
      toast.success("Exported", label)
    } catch (error) {
      toast.error("Export failed", getErrorMessage(error, "Export failed"))
    } finally {
      setExportingKey(null)
    }
  }

  return (
    <Panel>
      <PanelHead title="Export" />
      <PanelBody>
        <div className="stack-sm">
          <h3 className="panel-title">Profiles</h3>
          {profiles.length === 0 ? (
            <p className="text-dim">No profiles to export.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th>Kind</Th>
                  <Th className="cell-actions" />
                </tr>
              </thead>
              <tbody>
                {profiles.map((profile) => {
                  const key = `profile-${profile.id}`
                  return (
                    <tr key={key}>
                      <Td>{profile.name}</Td>
                      <Td>
                        <Tag>profile</Tag>
                      </Td>
                      <Td actions>
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<IconDownload size={15} />}
                          loading={exportingKey === key}
                          onClick={() =>
                            void runExport(
                              key,
                              `profile-${profile.id}.json`,
                              () => fetchProfileExport(profile.id),
                              profile.name,
                            )
                          }
                        >
                          Export
                        </Button>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
        </div>
      </PanelBody>
      <PanelBody>
        <div className="stack-sm">
          <h3 className="panel-title">Autoruns</h3>
          {autoruns.isLoading ? (
            <SkeletonRows rows={4} cols={3} />
          ) : autoruns.isError ? (
            <ErrorPanel
              message={getErrorMessage(autoruns.error, "Could not load autoruns")}
              onRetry={autoruns.refetch}
            />
          ) : autoruns.items.length === 0 ? (
            <EmptyState title="No autoruns to export." />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Kind</Th>
                    <Th className="cell-actions" />
                  </tr>
                </thead>
                <tbody>
                  {autoruns.items.map((autorun) => {
                    const key = `autorun-${autorun.id}`
                    return (
                      <tr key={key}>
                        <Td>{autorun.user_friendly_name}</Td>
                        <Td>
                          <Tag>autorun</Tag>
                        </Td>
                        <Td actions>
                          <Button
                            size="sm"
                            variant="outline"
                            icon={<IconDownload size={15} />}
                            loading={exportingKey === key}
                            onClick={() =>
                              void runExport(
                                key,
                                `autorun-${autorun.id}.json`,
                                () => fetchAutorunExport(autorun.id),
                                autorun.user_friendly_name,
                              )
                            }
                          >
                            Export
                          </Button>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
              <LoadMore
                hasMore={autoruns.hasMore}
                isFetching={autoruns.isFetching}
                onLoadMore={autoruns.loadMore}
                count={autoruns.totalCount}
              />
            </>
          )}
        </div>
      </PanelBody>
    </Panel>
  )
}

/* ── import half ─────────────────────────────────────────────────────── */

interface LookupOption {
  readonly id: number
  readonly name: string
}

function ResolutionControls({
  item,
  resolution,
  engines,
  resolvers,
  profiles,
  onChange,
}: {
  readonly item: ImportItem
  readonly resolution: ItemResolution
  readonly engines: readonly LookupOption[]
  readonly resolvers: readonly LookupOption[]
  readonly profiles: readonly LookupOption[]
  readonly onChange: (patch: Partial<ItemResolution>) => void
}) {
  const hashIssues = item.issues.filter((issue) => {
    const kind = issueKind(issue)
    return kind === "not_installed" || kind === "hash_mismatch"
  })
  const profileMissing = item.issues.some((issue) => issueKind(issue) === "profile_missing")
  const engineOverride = item.issues.some((issue) => issueKind(issue) === "engine_override")
  const bound = resolution.profile?.mode === "bind" ? resolution.profile : null

  if (hashIssues.length === 0 && !profileMissing && !engineOverride) {
    return <span className="text-dim">—</span>
  }

  return (
    <div className="stack-sm">
      {hashIssues.map((issue, index) => {
        const type = issuePluginType(issue)
        const hash = issueOriginHash(issue)
        const options = type === "engine" ? engines : resolvers
        const selected =
          resolution.plugin !== undefined && resolution.plugin.type === type
            ? String(resolution.plugin.id)
            : ""
        return (
          <Field
            key={`${type}-${index}`}
            label={`Map ${type}`}
            hint={
              hash === null ? (
                "No origin hash — cannot map this plugin"
              ) : (
                <span className="row" style={{ gap: "var(--s-2)" }}>
                  <span>origin hash</span>
                  <Hash value={hash} label={`${item.name} origin hash`} />
                </span>
              )
            }
          >
            <Select
              aria-label={`Map ${type} for ${item.name}`}
              value={selected}
              disabled={hash === null}
              onChange={(event) => {
                if (hash === null || event.target.value === "") return
                onChange({ plugin: { type, id: Number(event.target.value) }, pluginHash: hash })
              }}
            >
              <option value="">{`Select an installed ${type}…`}</option>
              {options.map((option) => (
                <option key={option.id} value={String(option.id)}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>
        )
      })}

      {profileMissing ? (
        <div className="stack-sm">
          <Radio
            name={`profile-${item.name}`}
            label="Bind to existing profile"
            checked={bound !== null}
            onChange={() =>
              onChange({ profile: { mode: "bind", profileName: profiles[0]?.name ?? "" } })
            }
          />
          {bound !== null ? (
            <Field label="Profile">
              <Select
                aria-label={`Profile for ${item.name}`}
                value={bound.profileName}
                onChange={(event) =>
                  onChange({ profile: { mode: "bind", profileName: event.target.value } })
                }
              >
                <option value="">Select a profile…</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.name}>
                    {profile.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Radio
            name={`profile-${item.name}`}
            label="Inline config"
            checked={resolution.profile?.mode === "inline"}
            onChange={() => onChange({ profile: { mode: "inline" } })}
          />
        </div>
      ) : null}

      {engineOverride ? (
        <div className="stack-sm">
          <Radio
            name={`engine-${item.name}`}
            label="Keep autorun engine"
            checked={resolution.engine?.mode === "keep"}
            onChange={() => onChange({ engine: { mode: "keep" } })}
          />
          <Radio
            name={`engine-${item.name}`}
            label="Use profile engine"
            checked={resolution.engine?.mode === "profile"}
            onChange={() => onChange({ engine: { mode: "profile" } })}
          />
        </div>
      ) : null}
    </div>
  )
}

function ImportPanel() {
  const queryClient = useQueryClient()
  const engines = useEngines()
  const resolvers = useResolvers()
  const profiles = useProfiles()

  const [bundle, setBundle] = useState<unknown | null>(null)
  const [report, setReport] = useState<ImportValidateReport | null>(null)
  const [resolutions, setResolutions] = useState<Resolutions>({})
  const [fileError, setFileError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [pasted, setPasted] = useState("")
  const [bundleUrl, setBundleUrl] = useState("")
  const [summary, setSummary] = useState<ImportApplySummary | null>(null)
  const pastItems = useMemo(() => (bundle === null ? [] : pastAutoruns(bundle)), [bundle])

  const validate = useMutation({
    mutationFn: (value: unknown) => validateBundle(value),
    onSuccess: (result) => {
      setReport(result)
      setResolutions({})
    },
    onError: (error) => setFileError(getErrorMessage(error, "Validation failed")),
  })

  const apply = useMutation({
    mutationFn: (body: ApplyBody) => applyImport(body),
    onSuccess: (result) => {
      setSummary(result)
      setBundle(null)
      setReport(null)
      setResolutions({})
      void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
    },
    onError: (error) => toast.error("Import failed", getErrorMessage(error, "Import failed")),
  })

  const clearStaged = () => {
    setBundle(null)
    setReport(null)
    setResolutions({})
    setFileName(null)
    setFileSize(null)
  }

  const stage = (parsed: unknown): void => {
    setFileError(null)
    setSummary(null)
    if (!isSupportedVersion(parsed)) {
      clearStaged()
      setFileError(UNSUPPORTED_VERSION)
      return
    }
    const count = countBundleItems(parsed)
    if (count > BUNDLE_ITEM_LIMIT) {
      clearStaged()
      setFileError(`This bundle has ${count} items — the server accepts up to ${BUNDLE_ITEM_LIMIT}.`)
      return
    }
    setBundle(parsed)
    setReport(null)
    setResolutions({})
    validate.mutate(parsed)
  }

  const stageText = (text: string): void => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      clearStaged()
      setFileError(UNREADABLE_FILE)
      return
    }
    stage(parsed)
  }

  const handleFile = async (file: File): Promise<void> => {
    setFileName(file.name)
    setFileSize(file.size)
    stageText(await file.text())
  }

  const fetchUrl = useMutation({
    mutationFn: (value: string) => fetchBundleFromUrl(value),
    onSuccess: (parsed) => stage(parsed),
    onError: (error) => setFileError(getErrorMessage(error, "Could not read that URL")),
  })

  const setResolution = (name: string, patch: Partial<ItemResolution>) => {
    setResolutions((current) => {
      const base = current[name] ?? { included: true }
      return { ...current, [name]: { ...base, ...patch } }
    })
  }

  const includedOf = (item: ImportItem): boolean => (resolutions[item.name] ?? { included: true }).included
  const allIncluded =
    report !== null && report.items.length > 0 && report.items.every(includedOf)
  const setAllIncluded = (included: boolean) => {
    if (report === null) return
    setResolutions((current) => {
      const next: Resolutions = { ...current }
      for (const item of report.items) {
        next[item.name] = { ...(next[item.name] ?? { included: true }), included }
      }
      return next
    })
  }

  const canApply = report !== null && bundle !== null && !apply.isPending

  const runApply = () => {
    if (bundle === null || report === null) return
    apply.mutate(buildApplyBody(bundle, report.items, resolutions))
  }

  return (
    <Panel>
      <PanelHead title="Import" />
      <PanelBody>
        <div className="stack">
          <Field label="Bundle file" hint="A version 1 JSON bundle of profiles and autoruns.">
            <FilePicker
              accept="application/json,.json"
              label="Choose a bundle file"
              fileName={fileName}
              fileSize={fileSize}
              onFile={(file) => void handleFile(file)}
              onClear={clearStaged}
            />
          </Field>

          <Field label="Paste JSON" hint="Or paste a version 1 bundle straight from your clipboard.">
            <div className="stack-sm">
              <Textarea
                rows={4}
                aria-label="Pasted bundle JSON"
                placeholder='{ "version": 1, "profiles": [], "autoruns": [] }'
                value={pasted}
                onChange={(event) => setPasted(event.target.value)}
              />
              <Button disabled={pasted.trim() === ""} onClick={() => stageText(pasted)}>
                Load pasted JSON
              </Button>
            </div>
          </Field>

          <Field label="Direct file URL" hint="Any http(s) URL that returns the bundle JSON directly.">
            <div className="stack-sm">
              <Input
                type="url"
                aria-label="Bundle URL"
                placeholder="https://example.com/mirrorr-bundle.json"
                value={bundleUrl}
                onChange={(event) => setBundleUrl(event.target.value)}
              />
              <Button
                loading={fetchUrl.isPending}
                disabled={bundleUrl.trim() === ""}
                onClick={() => fetchUrl.mutate(bundleUrl.trim())}
              >
                Load from URL
              </Button>
            </div>
          </Field>

          {fileError !== null ? (
            <Banner kind="danger" title="Cannot read this bundle">
              {fileError}
            </Banner>
          ) : null}
          {summary !== null ? (
            <Banner kind="info" title="Import complete">
              <div className="stack-sm">
                <span>
                  {`${summary.profiles_created} profiles created · ${summary.profiles_skipped} skipped · ${summary.autoruns_created} autoruns created.`}
                </span>
                {summary.discarded_autoruns.length > 0 ? (
                  <span>
                    {`Discarded ${summary.discarded_autoruns.length} already-started: ${summary.discarded_autoruns.map((item) => item.name).join(", ")}.`}
                  </span>
                ) : null}
              </div>
            </Banner>
          ) : null}

          {bundle !== null && pastItems.length > 0 ? (
            <Banner
              kind="warning"
              title={`${pastItems.length} ${pastItems.length === 1 ? "item has" : "items have"} already started and will be skipped`}
            >
              {`Discarded on import: ${pastItems.map((item) => item.name).join(", ")}.`}
            </Banner>
          ) : null}

          {validate.isPending ? <SkeletonRows rows={4} cols={4} /> : null}

          {report !== null ? (
            report.items.length === 0 ? (
              <EmptyState title="Nothing to import." text="This bundle contains no profiles or autoruns." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th className="cell-check">
                      <Checkbox
                        aria-label="Include all items"
                        checked={allIncluded}
                        onChange={(event) => setAllIncluded(event.target.checked)}
                      />
                    </Th>
                    <Th>Name</Th>
                    <Th>Kind</Th>
                    <Th>Status</Th>
                    <Th>Issues</Th>
                    <Th>Resolution</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.items.map((item) => {
                    const resolution = resolutions[item.name] ?? { included: true }
                    const badge = itemBadge(item)
                    const rename = suggestedRename(item)
                    return (
                      <tr key={`${item.kind}:${item.name}`}>
                        <Td>
                          <Checkbox
                            aria-label={`Include ${item.name}`}
                            checked={resolution.included}
                            onChange={() => setResolution(item.name, { included: !resolution.included })}
                          />
                        </Td>
                        <Td>
                          <div className="stack-sm">
                            <span>{item.name}</span>
                            {rename !== null ? <span className="text-dim">{`→ ${rename}`}</span> : null}
                          </div>
                        </Td>
                        <Td>
                          <Tag>{item.kind}</Tag>
                        </Td>
                        <Td>
                          <Badge variant={BADGE_VARIANT[badge]}>{BADGE_LABELS[badge]}</Badge>
                        </Td>
                        <Td>
                          {item.issues.length === 0 ? (
                            <span className="text-dim">No issues</span>
                          ) : (
                            <div className="stack-sm">
                              {item.issues.map((issue, index) => {
                                const hash = issueOriginHash(issue)
                                return (
                                  <span
                                    key={`${issue.type}-${index}`}
                                    className="row"
                                    style={{ gap: "var(--s-2)" }}
                                  >
                                    <Tag>{issueKind(issue)}</Tag>
                                    {hash !== null ? (
                                      <Hash value={hash} label={`${item.name} origin hash`} />
                                    ) : null}
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </Td>
                        <Td>
                          <ResolutionControls
                            item={item}
                            resolution={resolution}
                            engines={engines}
                            resolvers={resolvers}
                            profiles={profiles}
                            onChange={(patch) => setResolution(item.name, patch)}
                          />
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )
          ) : null}
        </div>
      </PanelBody>
      <PanelFoot>
        <Button variant="primary" loading={apply.isPending} disabled={!canApply} onClick={runApply}>
          Apply import
        </Button>
      </PanelFoot>
    </Panel>
  )
}

export function ImportExportView() {
  return (
    <Page
      title="Import / Export"
      description="Move profiles and autoruns between Mirrorr instances as versioned JSON bundles."
    >
      <ExportPanel />
      <ImportPanel />
    </Page>
  )
}
