# Import Dialog Rework Design

## Overview

Rework the import dialog to be larger, more interactive, and feature-rich. The dialog should feel like a full-screen application with advanced selection, filtering, and batch operations.

## Key Changes

### 1. Modal Size & Layout

**Current**: `max-w-2xl max-h-[85vh]` (672px wide, 85% viewport height)
**New**: `w-[90vw] h-[90vh] max-w-[1400px]` (90% viewport width/height, capped at 1400px)

The modal should feel like a near-fullscreen application, not a small dialog.

### 2. Summary Header

Add a persistent summary bar at the top showing:
- Total items count
- Profiles/Autoruns breakdown
- Items with issues count
- Items removed count
- Clear visual indicators for each category

Example:
```
📦 Import Bundle  │  12 items  │  8 profiles  │  4 autoruns  │  3 issues  │  2 removed
```

### 3. Toolbar with Search & Filters

Add a toolbar below the summary with:
- **Search input**: Filter items by name, plugin name, or issue type
- **Filter dropdown**: Filter by status (All, Ready, Issues, Removed)
- **Batch actions**: Select All, Deselect All, Remove Selected, Re-include Selected

### 4. Grid of Cards

Keep the existing card-based layout but arrange items in a responsive grid:

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ ☑ Profile 1             │  │ ☐ Profile 2             │  │ ☐ Profile 3             │
│ ✅ Ready to import       │  │ ⚠️ Needs resolution      │  │ 🚫 Removed              │
│ ─────────────────────── │  │ ─────────────────────── │  │ ─────────────────────── │
│ Engine: yt-dlp          │  │ Engine: yt-dlp          │  │ Engine: yt-dlp          │
│ Resolver: piped         │  │ Resolver: piped         │  │ Resolver: piped         │
│ [Expand ▾]              │  │ [Expand ▾]              │  │ [Expand ▾]              │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘

┌─────────────────────────┐  ┌─────────────────────────┐
│ ☑ Autorun 1             │  │ ☐ Autorun 2             │
│ ✅ Ready to import       │  │ ⚠️ Needs resolution      │
│ ─────────────────────── │  │ ─────────────────────── │
│ Profile: Profile 1      │  │ Profile: Profile 2      │
│ Recording: Yes          │  │ Recording: No           │
│ [Expand ▾]              │  │ [Expand ▾]              │
└─────────────────────────┘  └─────────────────────────┘
```

Grid layout: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3`

Each card is clickable (like sidebar entries) with:
- **Plain click**: Selects the card (sets anchor, deselects others)
- **Ctrl/Cmd+click**: Toggles selection (adds/removes from selection)
- **Shift+click**: Range select from anchor to clicked card
- **Click header or expand button**: Expands to show details

Cards preserve the existing collapsible design:
- **Collapsed**: Shows name, status badge, key metadata (engine, resolver, profile name)
- **Expanded**: Shows full details (plugin cells, config previews, issue rows)

### 5. Selection Logic (Same as Sidebar)

Reuse the existing `MultiSelectProvider` pattern from `use-multi-select.tsx`:
- `selectedIds: Set<number>` tracks selected items
- `handleModifierClick(id, event)` for Ctrl/Shift logic
- `handlePlainClick(id)` for single selection
- Visual highlight on selected rows (blue background, like sidebar)

### 6. Expanded Row Details

When a row is expanded (like current collapsible cards), show:
- Full plugin cells (engine/resolver with hash copy)
- Config previews (resolver_config, retry_config)
- Issue rows with inline resolution
- Content hash

The expanded content should match the current `ProfilePreviewCard` and `AutorunPreviewCard` expanded views, but integrated into the table row.

### 7. Removed Items Behavior

Items marked for removal:
- **Stay visible** in the list
- **Visual treatment**: Greyed out background, strikethrough text, muted colors
- **Checkbox**: Unchecked, with a "removed" badge
- **Re-include**: Click checkbox or use batch "Re-include Selected" to restore
- **Backend contract**: Send `removed_profiles: string[]` and `removed_autoruns: string[]` to `apply()` endpoint

### 8. Import Button Behavior

- **Disabled** when all items are removed (nothing to import)
- **Shows count**: "Import (10 items)" or "Import (8 items, 2 skipped)"
- **Sends**: `{ bundle, plugin_map, removed_profiles, removed_autoruns }`

## Backend Contract Changes

### Current
```python
@router.post("/apply")
async def apply_bundle(
    bundle: dict,
    plugin_map: dict,
    # ...
):
```

### New
```python
@router.post("/apply")
async def apply_bundle(
    bundle: dict,
    plugin_map: dict,
    removed_profiles: list[str] = [],  # Profile names to skip
    removed_autoruns: list[str] = [],  # Autorun names to skip
    # ...
):
```

The backend will filter out items whose names are in the removed lists before processing.

## Component Structure

```
ImportDialog (main)
├── DialogHeader (title + summary stats)
├── Toolbar
│   ├── SearchInput
│   ├── FilterDropdown
│   └── BatchActions (Select All, Deselect All, Remove, Re-include)
├── ScrollArea (main content)
│   └── ItemGrid (responsive grid)
│       └── ItemCard[] (each with checkbox, name, status, expand button)
│           └── CollapsibleContent (when expanded)
│               ├── PluginCells
│               ├── ConfigPreview
│               └── IssueRows
├── DialogFooter
│   ├── CancelButton
│   └── ImportButton (with count)
```

## Files to Modify

1. **`src/components/import-dialog.tsx`** - Main rework
2. **`src/lib/api.ts`** - Update `apply()` to accept removed lists
3. **`mirrorr-core/src/api/routers/import_export.py`** - Backend endpoint change

## Visual Reference

The expanded row details should match the current UI elements in:
- `ProfilePreviewCard` expanded view (plugin cells, config previews)
- `AutorunPreviewCard` expanded view (time range, plugin override)
- `PluginCell` component (hover-to-reveal hash, click-to-copy)
- `ConfigPreview` component (key-value table)

The selection behavior should match:
- `MultiSelectProvider` from `hooks/use-multi-select.tsx`
- Sidebar entry selection in `resource-layout.tsx`

The grid layout should use:
- Responsive grid: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3`
- Cards with consistent styling matching existing collapsible cards
- Visual treatment for removed items: greyed out background, strikethrough text

## Success Criteria

1. Modal is significantly larger (90vw/90vh)
2. Items are displayed in a table-like list, not stacked cards
3. Multi-select works with Ctrl/Shift clicks (identical to sidebar)
4. Search and filter work correctly
5. Batch remove/re-include works
6. Removed items stay visible but greyed out
7. Import button sends removed lists to backend
8. All existing functionality preserved (plugin mapping, issue resolution)
9. No regression in existing import/export flows
