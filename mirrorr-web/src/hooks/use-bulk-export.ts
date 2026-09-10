import { useState } from "react";
import { toast } from "sonner";
import { useMultiSelect } from "@/hooks/use-multi-select";
import { downloadJson } from "@/lib/utils";

export function useBulkExport(
	exportFn: (id: number) => Promise<unknown>,
	entityName: string,
	filenamePrefix: string,
) {
	const multi = useMultiSelect();
	const [isPending, setIsPending] = useState(false);

	const handleExport = async () => {
		const ids = [...multi.selectedIds];
		setIsPending(true);
		try {
			const results = await Promise.allSettled(
				ids.map(async (id) => {
					const bundle = await exportFn(id);
					downloadJson(`${filenamePrefix}-${id}-export.json`, bundle);
				}),
			);
			const failures = results.filter((r) => r.status === "rejected");
			if (failures.length > 0) {
				toast.error(`${failures.length} of ${ids.length} exports failed`);
			} else {
				toast.success(`Exported ${ids.length} ${entityName.toLowerCase()}(s)`);
				multi.clear();
			}
		} catch (err: unknown) {
			toast.error(
				`Export failed: ${err instanceof Error ? err.message : String(err)}`,
			);
		} finally {
			setIsPending(false);
		}
	};

	return { handleExport, isPending, selectedIds: multi.selectedIds };
}
