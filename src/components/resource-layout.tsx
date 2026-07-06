/**
 * Reusable layout components for resource pages (Sessions, Autoruns, Recordings, Profiles).
 * These eliminate repeated sidebar/detail panel patterns.
 *
 * Compose them as:
 *   SidebarLayout + SidebarEntry for the left panel
 *   DetailLayout + DetailHeader for the right panel header
 *   EmptyDetail for the empty state
 *   CreatePanel for create forms with sticky submit button
 */
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Plus, ArrowLeft, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"

// ── Sidebar layout ─────────────────────────────────────────────

interface SidebarLayoutProps {
  title: string
  count: number | null
  countLabel: string
  subtitle?: string
  onNew?: () => void
  isLoading?: boolean
  emptyText?: string
  headerExtra?: React.ReactNode
  sidebarActions?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function SidebarLayout({ title, count, countLabel, subtitle, onNew, isLoading, emptyText = "Nothing here", headerExtra, sidebarActions, children, className }: SidebarLayoutProps) {
  return (
    <div className={cn("flex flex-col h-full w-full min-h-0 overflow-hidden", className)}>
      <div className="shrink-0 px-3.5 pt-4 pb-3 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">{title}</h1>
          {subtitle
            ? <p className="text-[11px] text-muted-foreground/60 mt-0.5 leading-relaxed">{subtitle}</p>
            : count != null && <p className="text-[11px] text-muted-foreground/60 mt-0.5">{count} {countLabel}</p>
          }
        </div>
        <div className="flex items-center gap-1">
          {sidebarActions}
          {onNew && (
            <Button size="sm" className="h-7 text-[11px]" onClick={onNew}>
              <Plus className="size-3 mr-1" />New
            </Button>
          )}
        </div>
      </div>
      {headerExtra}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-1.5">
          {isLoading ? (
            <div className="text-[11px] text-muted-foreground text-center py-6">Loading...</div>
          ) : count === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-6">{emptyText}</div>
          ) : (
            children
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

// ── Sidebar group container ──────────────────────────────────

import React from "react"
import { useMultiSelectOrNull } from "@/hooks/use-multi-select"

/**
 * Groups adjacent selected items under styled wrapper divs.
 * Uses display:contents on the outer wrapper so the styled inner div
 * becomes the direct grid child — identical box to what was there before.
 *
 * The inner div for multi-item groups replicates the parent's grid
 * (same grid-cols-1, same gap-px) so vertical rhythm is identical.
 * The accent bar lives on the inner div, continuous across all entries.
 */
export function SidebarGroupContainer({ children }: { children: React.ReactNode }) {
  const multi = useMultiSelectOrNull()
  const childArray = React.Children.toArray(children)

  if (!multi || multi.count === 0) {
    return <div className="grid grid-cols-1 gap-px">{childArray}</div>
  }

  // Group consecutive selected items
  const groups: { items: React.ReactNode[]; selected: boolean }[] = []
  for (const child of childArray) {
    const id = (child as React.ReactElement).props?.id
    const isSelected = id != null && multi.isSelected(id)
    const lastGroup = groups[groups.length - 1]
    if (isSelected && lastGroup?.selected) {
      lastGroup.items.push(child)
    } else {
      groups.push({ items: [child], selected: isSelected })
    }
  }

  const accentBar = <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r-full" />

  return (
    <div className="grid grid-cols-1 gap-px">
      {groups.map((group, gi) => {
        if (!group.selected) {
          return group.items.map((item, ii) => (
            <React.Fragment key={`${gi}-${ii}`}>{item}</React.Fragment>
          ))
        }
        const spanN = group.items.length
        return (
          <div key={gi} style={{ display: "contents" }}>
            {spanN === 1 ? (
              // Single selected: block container, no grid needed
              <div className="relative bg-primary/10 rounded-lg">
                {accentBar}
                {group.items}
              </div>
            ) : (
              // Multi selected: replicate parent grid so vertical rhythm is identical
              <div className="relative bg-primary/10 rounded-lg grid grid-cols-1 gap-px">
                {accentBar}
                {group.items}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Sidebar entry row ──────────────────────────────────────────

interface SidebarEntryProps {
  /** Item ID — when provided inside a MultiSelectProvider, enables auto-selection */
  id?: number
  /** Manual selected state (used outside MultiSelectProvider) */
  selected?: boolean
  /** Manual click handler */
  onClick?: (e: React.MouseEvent) => void
  children: React.ReactNode
  className?: string
}

export function SidebarEntry({ id, selected: manualSelected, onClick: manualOnClick, children, className }: SidebarEntryProps) {
  const multi = useMultiSelectOrNull()
  const inProvider = multi && id != null

  const isSelected = inProvider ? multi!.isSelected(id!) : (manualSelected ?? false)

  const handleClick = (e: React.MouseEvent) => {
    if (inProvider) {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        multi!.handleModifierClick(id!, e)
      } else {
        multi!.handlePlainClick(id!)
      }
    }
    manualOnClick?.(e)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    if (inProvider && (e.ctrlKey || e.metaKey || e.shiftKey)) {
      e.preventDefault()
    }
  }

  return (
    <div
      className={cn(
        "relative group px-2.5 py-2.5 transition-colors cursor-pointer select-none",
        !isSelected && "rounded-md hover:bg-muted/40",
        className,
      )}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
    >
      {children}
    </div>
  )
}

// ── Floating bulk action bar ──────────────────────────────────

interface BulkActionBarProps {
  /** Manual count (used outside MultiSelectProvider) */
  count?: number
  /** Manual clear handler (used outside MultiSelectProvider) */
  onClear?: () => void
  /** Action buttons — use Button component with "Bulk {action}" labels */
  actions?: React.ReactNode
}

/**
 * Floating rounded pill at bottom-center when items are multi-selected.
 * Auto-detects MultiSelectProvider for count/clear, or uses props.
 */
export function BulkActionBar({ count: manualCount, onClear: manualClear, actions }: BulkActionBarProps) {
  const multi = useMultiSelectOrNull()
  const count = multi ? multi.count : (manualCount ?? 0)
  const onClear = multi ? multi.clear : manualClear
  if (count < 1) return null
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background/95 backdrop-blur border rounded-full px-4 py-2 shadow-lg animate-in slide-in-from-bottom-2 fade-in duration-150">
      <span className="text-xs font-medium text-muted-foreground tabular-nums pl-1">
        {count} selected
      </span>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1">
        {actions}
      </div>
      <div className="w-px h-4 bg-border" />
      <Button variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground" onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}

// ── Detail panel header ────────────────────────────────────────

interface DetailHeaderProps {
  onBack: () => void
  title: string
  actions?: React.ReactNode
}

export function DetailHeader({ onBack, title, actions }: DetailHeaderProps) {
  return (
    <div className="shrink-0 px-5 pt-5 pb-3 border-b">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onBack}>
            <ArrowLeft className="size-3 mr-0.5" />Back
          </Button>
          <h2 className="text-sm font-bold">{title}</h2>
        </div>
        {actions && <div className="flex gap-1.5">{actions}</div>}
      </div>
    </div>
  )
}

// ── Detail panel layout ────────────────────────────────────────

interface DetailLayoutProps {
  header: React.ReactNode
  children: React.ReactNode
}

export function DetailLayout({ header, children }: DetailLayoutProps) {
  return (
    <div className="flex flex-col h-full">
      {header}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {children}
      </div>
    </div>
  )
}

// ── Empty detail panel ─────────────────────────────────────────

interface EmptyDetailProps {
  icon: React.ComponentType<{ className?: string }>
  text: string
}

export function EmptyDetail({ icon: Icon, text }: EmptyDetailProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <Icon className="size-8 mb-2 opacity-15" />
      <p className="text-xs">{text}</p>
    </div>
  )
}

// ── Create panel layout ────────────────────────────────────────

interface CreatePanelProps {
  title: string
  onClose: () => void
  submitLabel: string
  onSubmit: () => void
  isPending: boolean
  canSubmit?: boolean
  children: React.ReactNode
}

export function CreatePanel({ title, onClose, submitLabel, onSubmit, isPending, canSubmit = true, children }: CreatePanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-5 pt-5 pb-3 border-b">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold">{title}</h2>
          <Button variant="ghost" size="sm" className="h-6 text-[11px]" onClick={onClose}>Cancel</Button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0">
        <div className="absolute inset-x-0 bottom-0 z-10 px-5 py-3 flex justify-center">
          <Button size="sm" className="h-8 text-[11px] px-6 shadow-lg" onClick={onSubmit} disabled={!canSubmit || isPending}>
            {isPending && <Loader2 className="mr-1 size-3 animate-spin" />}
            {submitLabel}
          </Button>
        </div>
        <div className="h-full overflow-y-auto px-5 py-4 pb-14 space-y-3">
          {children}
        </div>
      </div>
    </div>
  )
}
