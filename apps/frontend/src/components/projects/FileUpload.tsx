import { useCallback, useState } from "react";
import { useExtractionSchemas } from "@packages/core-client";
import { Button, Card, CardContent, cn, Progress } from "@packages/ui";
import {
  AlertCircle,
  CheckCircle,
  CloudUpload,
  File,
  FileText,
  ImageIcon,
  RefreshCw,
  Upload,
  X
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { useFileUpload } from "@/hooks/use-file-upload";

interface FileUploadProps {
  projectId: string;
  onUploadComplete?: () => void;
}

interface SelectedFile {
  file: File;
  id: string;
}

export function FileUpload({ projectId, onUploadComplete }: FileUploadProps) {
  const {
    uploads,
    uploadFilesBatch,
    startExtractionJob,
    clearUploads,
    retryFailedUpload
  } = useFileUpload();

  const schemas = useExtractionSchemas();

  const [selectedFiles, setSelectedFiles] = useState<SelectedFile[]>([]);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    // Add files to selection list instead of immediately uploading
    const newFiles = acceptedFiles.map((file) => ({
      file,
      id: `${file.name}-${Date.now()}-${Math.random()}`
    }));
    setSelectedFiles((prev) => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        [".docx"],
      "image/*": [".png", ".jpg", ".jpeg", ".webp"]
    },
    maxSize: 50 * 1024 * 1024, // 50MB max file size
    multiple: true,
    noClick: false,
    noKeyboard: false
  });

  const removeFile = (id: string) => {
    setSelectedFiles((prev) => prev.filter((file) => file.id !== id));
  };

  const handleUpload = async () => {
    if (selectedFiles.length === 0) return;
    if (!selectedSchemaId) {
      return;
    }

    setIsUploading(true);
    try {
      // Step 1: Upload all files as a batch (creates data layers but no extraction jobs)
      const filesToUpload = selectedFiles.map((sf) => sf.file);
      const batchResult = await uploadFilesBatch(filesToUpload, projectId);

      // Step 2: Start single extraction job for all uploaded files with selected schema
      if (batchResult.dataLayerIds.length > 0) {
        await startExtractionJob(batchResult.dataLayerIds, selectedSchemaId);
      }

      // Clear selected files on successful upload
      setSelectedFiles([]);
      setSelectedSchemaId(""); // Reset schema selection
      onUploadComplete?.();
    } catch {
      // Error handled by upload state
    } finally {
      setIsUploading(false);
    }
  };

  const clearSelectedFiles = () => {
    setSelectedFiles([]);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith("image/")) return <ImageIcon className="size-4" />;
    if (file.type === "application/pdf") return <FileText className="size-4" />;
    return <File className="size-4" />;
  };

  const getFileTypeBadge = (file: File) => {
    if (file.type === "application/pdf") return "PDF";
    if (file.type.startsWith("image/")) return "IMG";
    return "FILE";
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-600" />;
      case "uploading":
      default:
        return <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />;
    }
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Schema Selection */}
      <Card className="border-primary/20 flex-shrink-0">
        <CardContent className="p-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">
              Extraction Schema <span className="text-destructive">*</span>
            </label>
            <p className="text-xs text-muted-foreground">
              Select the schema to use for extracting data from your files
            </p>
            <select
              value={selectedSchemaId}
              onChange={(e) => setSelectedSchemaId(e.target.value)}
              disabled={isUploading}
              className="w-full h-10 px-3 py-2 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-all"
            >
              <option value="">
                {isUploading
                  ? "Loading schemas..."
                  : "Select an extraction schema"}
              </option>
              {schemas.map((schema) => (
                <option key={schema.id} value={schema.id}>
                  {schema.name} (v{schema.version})
                </option>
              ))}
            </select>
            {!selectedSchemaId && (
              <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1.5">
                <AlertCircle className="size-3" />
                Schema selection required to complete upload
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Drop Zone - Compact when files selected, prominent when empty */}
      <div className="flex-shrink-0">
        {selectedFiles.length === 0 ? (
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg py-8 px-6 text-center cursor-pointer transition-all duration-200",
              "hover:border-primary hover:bg-primary/5",
              isDragActive
                ? "border-primary bg-primary/10"
                : "border-muted-foreground/30 bg-muted/20"
            )}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-3">
              <div
                className={cn(
                  "rounded-full p-3 transition-colors",
                  isDragActive ? "bg-primary/20" : "bg-primary/10"
                )}
              >
                <CloudUpload
                  className={cn(
                    "size-6 transition-colors",
                    isDragActive ? "text-primary" : "text-primary/70"
                  )}
                />
              </div>
              <div className="space-y-1">
                <div className="text-sm">
                  <span className="font-semibold text-foreground">
                    Click to upload
                  </span>{" "}
                  <span className="text-muted-foreground">
                    or drag and drop
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  PDF, DOCX, or image files (max 50 MB)
                </p>
              </div>
            </div>
          </div>
        ) : (
          <Button
            {...getRootProps()}
            variant="outline"
            className="w-full h-10 border-dashed"
            type="button"
          >
            <input {...getInputProps()} />
            <Upload className="h-4 w-4 mr-2" />
            Add More Files
          </Button>
        )}
      </div>

      {/* Selected Files List */}
      {selectedFiles.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden space-y-3">
          <div className="flex items-center justify-between flex-shrink-0">
            <h3 className="font-semibold text-sm">
              Files Ready for Upload ({selectedFiles.length})
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelectedFiles}
              disabled={isUploading}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 h-8 px-3 text-xs"
            >
              Clear All
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {selectedFiles.map((selectedFile, index) => (
              <Card
                key={selectedFile.id}
                className="overflow-hidden hover:shadow-sm transition-shadow"
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="flex items-center justify-center w-6 h-6 rounded bg-primary/15 text-primary text-xs font-semibold flex-shrink-0">
                        {index + 1}
                      </span>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {getFileIcon(selectedFile.file)}
                        <div className="flex-1 min-w-0">
                          <p
                            className="text-sm font-medium truncate"
                            title={selectedFile.file.name}
                          >
                            {selectedFile.file.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatFileSize(selectedFile.file.size)}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded flex-shrink-0">
                        {getFileTypeBadge(selectedFile.file)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(selectedFile.id)}
                      disabled={isUploading}
                      className="h-7 w-7 p-0 hover:bg-destructive/10 hover:text-destructive flex-shrink-0"
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {uploads.length > 0 && (
        <Card className="flex-shrink-0">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-sm">Upload Progress</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={clearUploads}
                disabled={uploads.some((u) => u.status === "uploading")}
                className="text-xs h-7"
              >
                Clear All
              </Button>
            </div>

            <div className="space-y-2">
              {uploads.map((upload, index) => (
                <div key={`${upload.fileName}-${index}`} className="space-y-1">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(upload.status)}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {upload.fileName}
                      </p>
                      {upload.status === "uploading" && (
                        <Progress
                          value={upload.progress}
                          className="mt-1 h-1"
                        />
                      )}
                      {upload.status === "completed" && (
                        <p className="text-xs text-green-600 mt-0.5">
                          Upload completed successfully
                        </p>
                      )}
                      {upload.status === "error" && (
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-xs text-red-600">
                            {upload.error || "Upload failed"}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => retryFailedUpload(upload.fileName)}
                            className="h-5 px-2 text-xs"
                          >
                            Retry
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground flex-shrink-0">
                      {upload.status === "uploading" && `${upload.progress}%`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Upload Action Footer - Sticky at bottom */}
      {selectedFiles.length > 0 && (
        <div className="flex-shrink-0 pt-4 border-t mt-auto">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <p className="text-sm font-semibold">
                {selectedFiles.length} file
                {selectedFiles.length !== 1 ? "s" : ""} selected
              </p>
              <p className="text-xs text-muted-foreground">
                Total size:{" "}
                {formatFileSize(
                  selectedFiles.reduce(
                    (total, file) => total + file.file.size,
                    0
                  )
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                onClick={clearSelectedFiles}
                disabled={isUploading}
                className="flex-1 sm:flex-none"
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={
                  isUploading || selectedFiles.length === 0 || !selectedSchemaId
                }
                className="gap-2 flex-1 sm:flex-none"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Upload {selectedFiles.length} File
                    {selectedFiles.length !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
