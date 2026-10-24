import { useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Catalog } from "@/components/admin-types";
import {
  exportDepartmentsJson,
  parseCatalogJson,
  mergeCatalogByDepartment,
} from "@/components/admin-catalog";

type Props = {
  catalog: Catalog;
  saving: boolean;
  persist: (next: Catalog) => Promise<boolean>;
  onReload: () => Promise<void>;
};

export function AdminCatalogActions({ catalog, saving, persist, onReload }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      const incoming = parseCatalogJson(text);
      const deptN = incoming.departments.length;
      const examN = incoming.departments.reduce((s, d) => s + (d.exams || []).length, 0);
      const qsN = incoming.departments.reduce(
        (s, d) => s + (d.exams || []).reduce((a, x) => a + (x.questions?.length || 0), 0),
        0,
      );
      const merge = window.confirm(
        `Import ${deptN} department(s), ${examN} exam(s), ${qsN} stored question(s).\n\n` +
          "OK = Merge into existing catalog (same department/exam id updates)\n" +
          "Cancel = Replace entire catalog with this file",
      );
      const next = merge
        ? mergeCatalogByDepartment(catalog, incoming)
        : { ...incoming, updatedAt: new Date().toISOString() };
      const ok = await persist(next);
      if (ok) {
        toast.success(
          merge
            ? `Merged ${deptN} department(s) · ${examN} exam(s)`
            : `Replaced catalog · ${deptN} department(s) · ${examN} exam(s)`,
        );
      }
    } catch (err) {
      toast.error((err as Error).message || "Import failed");
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
      <p className="text-sm font-semibold">Catalog</p>
      <p className="text-xs text-muted-foreground">
        Export a backup, or import departments and exams (including stored questions) from JSON.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            exportDepartmentsJson(catalog);
            toast.success("Downloaded");
          }}
        >
          Export JSON
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={() => inputRef.current?.click()}
        >
          Import JSON
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            void onImportFile(f);
          }}
        />
        <Button type="button" variant="outline" onClick={() => void onReload()}>
          Reload from server
        </Button>
      </div>
      {catalog.updatedAt && catalog.updatedAt !== new Date(0).toISOString() && (
        <p className="text-[11px] text-muted-foreground">
          Last updated {new Date(catalog.updatedAt).toLocaleString()}
        </p>
      )}
    </div>
  );
}
