import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  applyImport,
  buildApplyBody,
  BUNDLE_ITEM_LIMIT,
  countBundleItems,
  deleteAutorun,
  deleteProfile,
  fetchBundleFromUrl,
  getErrorMessage,
  isSupportedVersion,
  pastAutoruns,
  useEngines,
  useProfiles,
  useResolvers,
  validateBundle,
  type ApplyBody,
  type ImportApplySummary,
  type ImportItem,
  type ImportValidateReport,
} from "@/api"
import { queryRoots } from "@/api/query-keys"
import {
  Banner,
  Button,
  ConfirmDialog,
  ErrorPanel,
  Field,
  FilePicker,
  FilterSegmented,
  Input,
  Panel,
  PanelBody,
  PanelFoot,
  PanelHead,
  SkeletonRows,
  Textarea,
  toast,
  panelTitleClass,
} from "@/ui/components"
import { pluralize } from "@/ui/lib/format"
import { ImportPreview } from "./import-preview"
import {
  applyBlockReason,
  collisionDeletions,
  createdNames,
  initialResolutions,
  itemKey,
  selectedCount,
  withCollision,
  withIncluded,
  type CollisionMode,
  type ImportResolution,
} from "./import-logic"
import { readWatermark, revertImport, type ImportWatermark } from "./undo-import"

const UNREADABLE_FILE = "That file is not valid JSON — choose a mirrorr bundle."
const UNSUPPORTED_VERSION = "Unsupported bundle version — this console reads version 1 bundles."
const EXAMPLE_BUNDLE = '{ "version": 1, "profiles": [], "autoruns": [] }'

type Step = "choose" | "preview" | "applied"
type SourceMode = "file" | "paste" | "url"

const SOURCE_MODES = [
  { id: "file", label: "File" },
  { id: "paste", label: "Paste" },
  { id: "url", label: "URL" },
] as const

function summaryLine(summary: ImportApplySummary): string {
  const parts = [
    `${pluralize(summary.profiles_created, "profile")} created`,
    summary.profiles_skipped > 0 ? `${summary.profiles_skipped} skipped` : null,
    `${pluralize(summary.autoruns_created, "autorun")} created`,
  ].filter((part) => part !== null)
  return `${parts.join(" · ")}.`
}

interface ApplyRequest {
  readonly body: ApplyBody
  readonly deletions: readonly { readonly kind: "profile" | "autorun"; readonly id: number }[]
  readonly names: ReturnType<typeof createdNames>
}

export function ImportWizard() {
  const queryClient = useQueryClient()
  const engines = useEngines()
  const resolvers = useResolvers()
  const profiles = useProfiles()

  const [step, setStep] = useState<Step>("choose")
  const [sourceMode, setSourceMode] = useState<SourceMode>("file")
  const [bundle, setBundle] = useState<unknown | null>(null)
  const [report, setReport] = useState<ImportValidateReport | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, ImportResolution>>({})
  const [fileError, setFileError] = useState<string | null>(null)
  const [validateError, setValidateError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  const [pasted, setPasted] = useState("")
  const [bundleUrl, setBundleUrl] = useState("")
  const [summary, setSummary] = useState<ImportApplySummary | null>(null)
  const [pendingReplacement, setPendingReplacement] = useState<unknown | null>(null)
  const [watermark, setWatermark] = useState<ImportWatermark | null>(null)
  const [undoNames, setUndoNames] = useState<ReturnType<typeof createdNames> | null>(null)
  const [undoing, setUndoing] = useState(false)
  const [replaced, setReplaced] = useState(false)

  const pastItems = useMemo(() => (bundle === null ? [] : pastAutoruns(bundle)), [bundle])

  const invalidateLists = (): void => {
    void queryClient.invalidateQueries({ queryKey: queryRoots.profiles })
    void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
  }

  const validate = useMutation({
    mutationFn: (value: unknown) => validateBundle(value),
    onSuccess: (result) => {
      setReport(result)
      setResolutions(initialResolutions(result.items))
    },
    onError: (error) => setValidateError(getErrorMessage(error, "Validation failed")),
  })

  const apply = useMutation({
    mutationFn: async (request: ApplyRequest) => {
      // Replace has no server flag: the installed item goes first so the import
      // can take its name. This is why undo cannot bring a replaced item back.
      for (const target of request.deletions) {
        if (target.kind === "autorun") await deleteAutorun(target.id)
        else await deleteProfile(target.id)
      }
      return applyImport(request.body)
    },
    onSuccess: (result, request) => {
      setSummary(result)
      setUndoNames(request.names)
      setReplaced(request.deletions.length > 0)
      setStep("applied")
      setBundle(null)
      setReport(null)
      setResolutions({})
      setFileName(null)
      setFileSize(null)
      invalidateLists()
      toast.success("Import complete", summaryLine(result), {
        label: "Undo",
        onClick: () => void undoImport(request.names),
      })
    },
    onError: (error) => toast.error("Import failed", getErrorMessage(error, "Import failed")),
  })

  const clearStaged = (): void => {
    setBundle(null)
    setReport(null)
    setResolutions({})
    setFileName(null)
    setFileSize(null)
    setValidateError(null)
    setStep("choose")
  }

  const stage = (parsed: unknown): void => {
    setFileError(null)
    setValidateError(null)
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
    setStep("preview")
    readWatermark().then(setWatermark, () => setWatermark(null))
    validate.mutate(parsed)
  }

  const requestStage = (parsed: unknown): void => {
    if (bundle !== null) {
      setPendingReplacement(parsed)
      return
    }
    stage(parsed)
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
    requestStage(parsed)
  }

  const handleFile = async (file: File): Promise<void> => {
    setFileName(file.name)
    setFileSize(file.size)
    stageText(await file.text())
  }

  const fetchUrl = useMutation({
    mutationFn: (value: string) => fetchBundleFromUrl(value),
    onSuccess: (parsed) => requestStage(parsed),
    onError: (error) => setFileError(getErrorMessage(error, "Could not read that URL")),
  })

  const setResolution = (item: ImportItem, patch: Partial<ImportResolution>): void => {
    setResolutions((current) => {
      const base = current[itemKey(item)] ?? { included: false }
      return { ...current, [itemKey(item)]: { ...base, ...patch } }
    })
  }

  const setCollision = (item: ImportItem, mode: CollisionMode): void => {
    setResolutions((current) => {
      const base = current[itemKey(item)] ?? { included: false }
      return { ...current, [itemKey(item)]: withCollision(base, mode) }
    })
  }

  const setAllIncluded = (included: boolean): void => {
    if (report === null) return
    setResolutions((current) => {
      const next: Record<string, ImportResolution> = { ...current }
      for (const item of report.items) {
        const base = next[itemKey(item)] ?? { included }
        next[itemKey(item)] = withIncluded(base, included)
      }
      return next
    })
  }

  const runApply = (): void => {
    if (bundle === null || report === null) return
    apply.mutate({
      body: buildApplyBody(bundle, report.items, resolutions),
      deletions: collisionDeletions(report.items, resolutions),
      names: createdNames(report.items, resolutions),
    })
  }

  const undoImport = async (names: ReturnType<typeof createdNames> | null): Promise<void> => {
    if (names === null) return
    if (watermark === null) {
      toast.error("Cannot undo this import", "The items present before the import were never recorded.")
      return
    }
    setUndoing(true)
    try {
      const removed = await revertImport(watermark, names)
      invalidateLists()
      setSummary(null)
      setUndoNames(null)
      setWatermark(null)
      setReplaced(false)
      setStep("choose")
      toast.success("Import undone", `${pluralize(removed, "item")} removed.`)
    } catch (error) {
      toast.error("Could not undo the import", getErrorMessage(error, "Request failed"))
    } finally {
      setUndoing(false)
    }
  }

  const items = report?.items ?? []
  const blockReason = report === null ? null : applyBlockReason(items, resolutions)
  const checked = selectedCount(items, resolutions)
  const replacements = report === null ? 0 : collisionDeletions(items, resolutions).length
  const busyReason = validate.isPending
    ? "Checking the bundle…"
    : validateError !== null
      ? "The bundle could not be checked."
      : blockReason

  return (
    <>
      <Panel>
        <PanelHead
          title="Import"
          actions={
            step === "preview" ? (
              <Button size="sm" variant="ghost" onClick={() => setStep("choose")}>
                Choose another bundle
              </Button>
            ) : undefined
          }
        />
        <PanelBody>
          {step === "choose" ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 className={panelTitleClass}>Choose a bundle</h3>
                <p className="text-sm text-ink-muted">
                  A version 1 JSON bundle of profiles and autoruns.
                </p>
              </div>

              <FilterSegmented
                items={SOURCE_MODES}
                value={sourceMode}
                onChange={setSourceMode}
                ariaLabel="Bundle source"
              />

              {bundle !== null ? (
                <p className="text-sm text-ink-dim">
                  {`A bundle with ${pluralize(countBundleItems(bundle), "item")} is staged — choosing another replaces it.`}
                </p>
              ) : null}

              {sourceMode === "file" ? (
                <FilePicker
                  accept="application/json,.json"
                  label="Choose a bundle file"
                  fileName={fileName}
                  fileSize={fileSize}
                  onFile={(file) => void handleFile(file)}
                  onClear={clearStaged}
                />
              ) : null}

              {sourceMode === "paste" ? (
                <Field label="Bundle JSON" hint="Paste a version 1 bundle straight from your clipboard.">
                  <div className="flex flex-col gap-2">
                    <Textarea
                      rows={4}
                      aria-label="Pasted bundle JSON"
                      placeholder={EXAMPLE_BUNDLE}
                      value={pasted}
                      onChange={(event) => setPasted(event.target.value)}
                    />
                    <Button
                      disabled={pasted.trim() === ""}
                      onClick={() => stageText(pasted)}
                      className="self-start"
                    >
                      Preview bundle
                    </Button>
                  </div>
                </Field>
              ) : null}

              {sourceMode === "url" ? (
                <Field label="Direct file URL" hint="Any http(s) URL that returns the bundle JSON directly.">
                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      type="url"
                      aria-label="Bundle URL"
                      placeholder="https://example.com/mirrorr-bundle.json"
                      value={bundleUrl}
                      className="min-w-[240px] flex-1"
                      onChange={(event) => setBundleUrl(event.target.value)}
                    />
                    <Button
                      loading={fetchUrl.isPending}
                      disabled={bundleUrl.trim() === ""}
                      onClick={() => fetchUrl.mutate(bundleUrl.trim())}
                    >
                      Load
                    </Button>
                  </div>
                </Field>
              ) : null}

              {fileError !== null ? (
                <Banner kind="danger" title="Cannot read this bundle">
                  {fileError}
                </Banner>
              ) : null}
            </div>
          ) : null}

          {step === "preview" ? (
            <div className="flex flex-col gap-4">
              {validateError !== null ? (
                <ErrorPanel
                  message={validateError}
                  onRetry={() => {
                    setValidateError(null)
                    if (bundle !== null) validate.mutate(bundle)
                  }}
                />
              ) : null}
              {validate.isPending ? <SkeletonRows rows={4} cols={4} /> : null}
              {report !== null && validateError === null ? (
                <ImportPreview
                  report={report}
                  resolutions={resolutions}
                  pastNames={pastItems.map((item) => item.name)}
                  engines={engines}
                  resolvers={resolvers}
                  profiles={profiles}
                  onResolution={setResolution}
                  onCollision={setCollision}
                  onSelectAll={setAllIncluded}
                />
              ) : null}
            </div>
          ) : null}

          {step === "applied" && summary !== null ? (
            <div className="flex flex-col gap-4">
              <Banner kind="info" title="Import complete">
                <div className="flex flex-col gap-2">
                  <span>{summaryLine(summary)}</span>
                  {summary.discarded_autoruns.length > 0 ? (
                    <span>
                      {`Discarded ${summary.autoruns_discarded} already-started: ${summary.discarded_autoruns
                        .map((item) => item.name)
                        .join(", ")}.`}
                    </span>
                  ) : null}
                  {replaced ? (
                    <span className="text-warning">
                      Replace deleted the items it overwrote — undo removes the imports but cannot restore them.
                    </span>
                  ) : null}
                </div>
              </Banner>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="ghost"
                  loading={undoing}
                  disabled={undoNames === null || watermark === null}
                  onClick={() => void undoImport(undoNames)}
                >
                  Undo import
                </Button>
                <Button variant="secondary" onClick={clearStaged}>
                  Import another bundle
                </Button>
                {watermark === null ? (
                  <span className="text-sm text-dim">
                    Undo needs the items that existed before the import, and reading them failed.
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </PanelBody>

        {step === "preview" ? (
          <PanelFoot>
            <div className="flex w-full flex-wrap items-center justify-end gap-3">
              {replacements > 0 ? (
                <span className="mr-auto text-sm text-warning">
                  {`Replaces ${pluralize(replacements, "existing item")}.`}
                </span>
              ) : busyReason !== null ? (
                <span className="mr-auto text-sm text-dim">{busyReason}</span>
              ) : null}
              <Button
                variant="primary"
                loading={apply.isPending}
                disabled={report === null || busyReason !== null}
                onClick={runApply}
              >
                {`Import ${pluralize(checked, "item")}`}
              </Button>
            </div>
          </PanelFoot>
        ) : null}
      </Panel>

      <ConfirmDialog
        open={pendingReplacement !== null}
        onClose={() => setPendingReplacement(null)}
        onConfirm={() => {
          const next = pendingReplacement
          setPendingReplacement(null)
          if (next !== null) stage(next)
        }}
        title="Replace the staged bundle?"
        description="The bundle you staged first is discarded, along with every choice you made in its preview."
        confirmLabel="Replace bundle"
        danger={false}
      />
    </>
  )
}
