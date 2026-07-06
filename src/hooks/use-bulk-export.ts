import { useState } from "react";
import { useMultiSelect } from "@/hooks/use-multi-select";
import { toast } from "sonner";
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
            for (const id of ids) {
                const bundle = await exportFn(id);
                downloadJson(`${filenamePrefix}-${id}-export.json`, bundle);
            }
            toast.success(
                `Exported ${ids.length} ${entityName.toLowerCase()}(s)`,
            );
            multi.clear();
        } catch (err: any) {
            toast.error(`Export failed: ${err.message}`);
        } finally {
            setIsPending(false);
        }
    };

    return { handleExport, isPending, selectedIds: multi.selectedIds };
}
