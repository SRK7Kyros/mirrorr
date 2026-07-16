/**
 * Reusable import/export buttons for resource pages.
 *
 * ImportButton — hidden file input + "Import" button, parses JSON and calls onBundle.
 * ExportButton — "Export" button with loading state, calls an async export function.
 */

import { Download, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { downloadJson } from "@/lib/utils";

// ── Import Button ──────────────────────────────────────────────

interface ImportButtonProps {
	onBundle: (bundle: Record<string, unknown>) => void;
}

export function ImportButton({ onBundle }: ImportButtonProps) {
	const ref = useRef<HTMLInputElement>(null);

	return (
		<>
			<input
				ref={ref}
				type="file"
				accept=".json"
				multiple
				className="hidden"
				onChange={(e) => {
					const file = e.target.files?.[0];
					if (!file) return;
					file.text().then((text) => {
						try {
							onBundle(JSON.parse(text));
						} catch {
							toast.error("Invalid JSON file");
						}
					});
					e.target.value = "";
				}}
			/>
			<Button
				size="sm"
				variant="ghost"
				className="h-7 text-xs"
				onClick={() => ref.current?.click()}
			>
				<Upload className="size-3 mr-1" />
				Import
			</Button>
		</>
	);
}

// ── Export Button ──────────────────────────────────────────────

interface ExportButtonProps {
	/** Async function that returns the bundle to export. */
	onExport: () => Promise<unknown>;
	/** Filename for the downloaded JSON (without extension). */
	filename: string;
}

export function ExportButton({ onExport, filename }: ExportButtonProps) {
	const [exporting, setExporting] = useState(false);

	async function handleClick() {
		setExporting(true);
		try {
			const bundle = await onExport();
			downloadJson(`${filename.replace(/\s+/g, "_")}.json`, bundle);
			toast.success("Exported");
		} catch (err: unknown) {
			toast.error(
				`Export failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setExporting(false);
		}
	}

	return (
		<Button
			variant="ghost"
			size="sm"
			className="h-7 text-xs"
			onClick={handleClick}
			disabled={exporting}
		>
			{exporting ? (
				<Loader2 className="size-3 mr-1 animate-spin" />
			) : (
				<Download className="size-3 mr-1" />
			)}
			Export
		</Button>
	);
}
