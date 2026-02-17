
import { useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@packages/ui";
import type { Supplier } from "@packages/types";
import { CheckCircle, FileText, Loader2, Upload, XCircle } from "lucide-react";
import { apiPost } from "@/lib/api";

interface ImportSuppliersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
}

type ImportStep = "upload" | "preview" | "importing" | "complete" | "error";

export function ImportSuppliersDialog({
  open,
  onOpenChange,
  onImportComplete
}: ImportSuppliersDialogProps) {
  const [step, setStep] = useState<ImportStep>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [previewSuppliers, setPreviewSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [importedCount, setImportedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.endsWith(".csv")) {
        setError("Please select a CSV file");
        return;
      }
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setStep("importing");
    setError(null);

    try {
      // Step 1: Get an upload URL for supplier imports (no project association)
      const uploadUrlResponse = await apiPost(
        "/suppliers/import-csv/upload-url",
        {
          fileName: file.name,
          contentType: file.type || "text/csv"
        }
      );

      if (!uploadUrlResponse.ok) {
        throw new Error("Failed to get upload URL");
      }

      const { uploadUrl, s3Key } = await uploadUrlResponse.json();

      // Step 2: Upload file to S3
      const uploadResponse = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "text/csv"
        }
      });

      if (!uploadResponse.ok) {
        throw new Error(
          `Failed to upload file to storage: ${uploadResponse.statusText}`
        );
      }

      // Wait a moment for S3 to process the file
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Step 3: Call import endpoint with S3 key
      console.log("Calling import with s3Key:", s3Key);
      const importResponse = await apiPost("/suppliers/import-csv", {
        fileId: s3Key
      });

      if (!importResponse.ok) {
        const errorData = await importResponse.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to import suppliers");
      }

      const result = await importResponse.json();
      setPreviewSuppliers(result.suppliers || []);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import CSV");
      setStep("error");
    }
  };

  const handleConfirmImport = async () => {
    setStep("importing");

    try {
      // The suppliers are already created by the backend
      // Just mark as complete
      setImportedCount(previewSuppliers.length);
      setStep("complete");

      // Notify parent to refresh
      setTimeout(() => {
        onImportComplete();
        handleClose();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm import");
      setStep("error");
    }
  };

  const handleClose = () => {
    setStep("upload");
    setFile(null);
    setPreviewSuppliers([]);
    setError(null);
    setImportedCount(0);
    onOpenChange(false);
  };

  const formatMaterials = (materials: unknown): string => {
    if (Array.isArray(materials)) {
      return (
        materials.slice(0, 3).join(", ") + (materials.length > 3 ? "..." : "")
      );
    }
    return "None";
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Suppliers from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV file containing supplier information. The system will
            extract and preview the data before importing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Upload Step */}
          {step === "upload" && (
            <div className="space-y-4">
              <div
                className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-sm font-medium mb-2">
                  {file ? file.name : "Click to upload or drag and drop"}
                </p>
                <p className="text-xs text-muted-foreground">
                  CSV files only. Should include columns for name, email, phone,
                  materials, etc.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              {file && (
                <div className="flex items-center justify-between p-4 bg-muted rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">{file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(file.size / 1024).toFixed(2)} KB
                      </p>
                    </div>
                  </div>
                  <Button onClick={handleUpload}>Process CSV</Button>
                </div>
              )}
            </div>
          )}

          {/* Preview Step */}
          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Found {previewSuppliers.length} suppliers
                </p>
                <Badge variant="secondary">Preview</Badge>
              </div>

              <div className="max-h-96 overflow-y-auto space-y-2">
                {previewSuppliers.map((supplier, idx) => (
                  <Card key={idx}>
                    <CardContent className="p-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-sm font-medium">{supplier.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {supplier.contactEmail}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">
                            {supplier.contactPhone || "No phone"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Materials:{" "}
                            {formatMaterials(supplier.materialsOffered)}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={handleClose}>
                  Cancel
                </Button>
                <Button onClick={handleConfirmImport}>Confirm Import</Button>
              </div>
            </div>
          )}

          {/* Importing Step */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
              <p className="text-sm font-medium">Processing suppliers...</p>
              <p className="text-xs text-muted-foreground">
                This may take a moment
              </p>
            </div>
          )}

          {/* Complete Step */}
          {step === "complete" && (
            <div className="flex flex-col items-center justify-center py-8">
              <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
              <p className="text-sm font-medium">Import Complete!</p>
              <p className="text-xs text-muted-foreground">
                Successfully imported {importedCount} suppliers
              </p>
            </div>
          )}

          {/* Error Step */}
          {step === "error" && (
            <div className="space-y-4">
              <div className="flex flex-col items-center justify-center py-8">
                <XCircle className="h-12 w-12 text-destructive mb-4" />
                <p className="text-sm font-medium">Import Failed</p>
                <p className="text-xs text-muted-foreground text-center max-w-md">
                  {error}
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={handleClose}>
                  Close
                </Button>
                <Button onClick={() => setStep("upload")}>Try Again</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
