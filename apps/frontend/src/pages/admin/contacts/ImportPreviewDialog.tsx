import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@packages/ui";
import { useLanguage } from "@/contexts/LanguageContext";
import type { ImportPreview } from "./types";

interface Props {
  importPreview: ImportPreview | null;
  onClose: () => void;
  onConfirm: () => void;
}

export function ImportPreviewDialog({ importPreview, onClose, onConfirm }: Props) {
  const { t } = useLanguage();

  return (
    <Dialog open={!!importPreview} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t.contacts.importPreviewTitle}</DialogTitle>
        </DialogHeader>
        {importPreview && (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <div className="text-sm">
                <span className="text-green-600 font-medium">
                  ✓ {importPreview.toImport.length} {t.contacts.importToImport}
                </span>
              </div>
              {importPreview.skipped > 0 && (
                <div className="text-sm">
                  <span className="text-amber-600">
                    ⚠ {importPreview.skipped} {t.contacts.importSkipped}
                  </span>
                </div>
              )}
              {importPreview.duplicates > 0 && (
                <div className="text-sm">
                  <span className="text-muted-foreground">
                    ↔ {importPreview.duplicates} {t.contacts.importDuplicates}
                  </span>
                </div>
              )}
              {importPreview.newGroupNames.length > 0 && (
                <div className="text-sm space-y-1">
                  <span className="text-blue-600">
                    + {importPreview.newGroupNames.length} {t.contacts.importNewGroups}
                  </span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {importPreview.newGroupNames.map((name) => (
                      <span key={name} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t.contactForm.cancel}</Button>
          <Button
            onClick={onConfirm}
            disabled={!importPreview || importPreview.toImport.length === 0}
            className="gradient-terracotta text-white hover:opacity-90"
          >
            {t.contacts.importConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
