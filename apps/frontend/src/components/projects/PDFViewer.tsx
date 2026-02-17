import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@packages/ui";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  RotateCw,
  ZoomIn,
  ZoomOut
} from "lucide-react";

interface PDFViewerProps {
  fileUrl: string;
  fileName: string;
  isOpen: boolean;
  onClose: () => void;
}

// Helper function to determine file type from URL or filename
const getFileType = (
  url: string,
  fileName: string
): "pdf" | "image" | "unknown" => {
  if (!url && !fileName) return "unknown";

  const extension = (fileName || url).split(".").pop()?.toLowerCase();

  if (extension === "pdf") return "pdf";

  // Common image formats
  const imageFormats = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "webp",
    "svg",
    "tiff"
  ];
  if (extension && imageFormats.includes(extension)) return "image";

  return "unknown";
};

// Loading component
const LoadingState = () => (
  <div className="w-[1200px] h-[1600px] bg-white border border-gray-300 flex items-center justify-center">
    <div className="text-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
      <p className="text-gray-500">Loading document...</p>
    </div>
  </div>
);

// Error component
const ErrorState = ({
  error,
  onRetry
}: {
  error: string;
  onRetry: () => void;
}) => (
  <div className="w-[1200px] h-[1600px] bg-white border border-gray-300 flex items-center justify-center">
    <div className="text-center space-y-4">
      <div className="flex justify-center">
        <FileText className="w-16 h-16 text-gray-400" />
      </div>
      <div className="space-y-2">
        <h3 className="text-xl font-semibold text-gray-900">
          Error Loading Document
        </h3>
        <p className="text-red-600 max-w-md">{error}</p>
      </div>
      <Button onClick={onRetry} variant="outline">
        Try Again
      </Button>
    </div>
  </div>
);

export function PDFViewer({
  fileUrl,
  fileName,
  isOpen,
  onClose
}: PDFViewerProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [zoom, setZoom] = useState(1.2);
  const [rotation, setRotation] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileType, setFileType] = useState<"pdf" | "image" | "unknown">(
    "unknown"
  );

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentPage(1);
      setZoom(1.2);
      setRotation(0);
      setLoading(true);
      setError(null);
      const detectedFileType = getFileType(fileUrl, fileName);
      setFileType(detectedFileType);

      // For PDFs, set a timeout to clear loading state since iframe events are unreliable
      if (detectedFileType === "pdf") {
        const timer = setTimeout(() => {
          setLoading(false);
        }, 2000); // 2 second timeout for PDF loading

        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [isOpen, fileUrl, fileName]);

  const handlePrevPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handleZoomIn = () => {
    setZoom(Math.min(zoom * 1.2, 3));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom / 1.2, 0.5));
  };

  const handleRotate = () => {
    setRotation((rotation + 90) % 360);
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRetry = useCallback(() => {
    setError(null);
    setLoading(true);
    setFileType(getFileType(fileUrl, fileName));

    // For PDFs, set a timeout to clear loading state
    if (getFileType(fileUrl, fileName) === "pdf") {
      setTimeout(() => {
        setLoading(false);
      }, 2000);
    }
  }, [fileUrl, fileName]);

  // Render document content based on file type
  const renderDocumentContent = () => {
    if (loading) {
      return <LoadingState />;
    }

    if (error) {
      return <ErrorState error={error} onRetry={handleRetry} />;
    }

    if (!fileUrl) {
      return <ErrorState error="No file URL provided" onRetry={handleRetry} />;
    }

    // Render based on file type
    if (fileType === "image") {
      return (
        <div
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: "center"
          }}
        >
          <img
            src={fileUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain border border-gray-300"
            style={{ maxWidth: "1200px", maxHeight: "1600px" }}
            onLoad={() => {
              setLoading(false);
              setTotalPages(1); // Images have only 1 "page"
            }}
            onError={() => {
              setLoading(false);
              setError("Failed to load image");
            }}
          />
        </div>
      );
    }

    if (fileType === "pdf") {
      return (
        <div
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
            transformOrigin: "center"
          }}
        >
          <iframe
            src={fileUrl}
            className="w-[1200px] h-[1600px] border border-gray-300"
            title={fileName}
            onLoad={() => {
              // Clear loading state when iframe loads
              setLoading(false);
              setTotalPages(1); // Default to 1 for iframe
            }}
          />
        </div>
      );
    }

    // Fallback for unknown file types
    return (
      <ErrorState
        error={`Unsupported file type: ${fileType}. Supported types: PDF, images (JPG, PNG, etc.)`}
        onRetry={handleRetry}
      />
    );
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-none h-[90vh] !w-[98vw] p-0 !max-w-none">
        <DialogHeader className="p-6 pb-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold truncate">
              {fileName}
            </DialogTitle>
          </div>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center justify-between px-6 py-3 border-b bg-gray-50 dark:bg-gray-800">
          <div className="flex items-center gap-2">
            {/* Page navigation - only show for multi-page documents */}
            {totalPages > 1 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePrevPage}
                  disabled={currentPage <= 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[80px] text-center">
                  {loading ? "Loading..." : `${currentPage} / ${totalPages}`}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNextPage}
                  disabled={currentPage >= totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </>
            )}

            {/* File type indicator */}
            <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded">
              {fileType.toUpperCase()}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleZoomOut}
              disabled={zoom <= 0.5}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>

            <span className="text-sm text-gray-600 dark:text-gray-400 min-w-[50px] text-center">
              {Math.round(zoom * 100)}%
            </span>

            <Button
              variant="outline"
              size="sm"
              onClick={handleZoomIn}
              disabled={zoom >= 3}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>

            <Button variant="outline" size="sm" onClick={handleRotate}>
              <RotateCw className="h-4 w-4" />
            </Button>

            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Document Content */}
        <div className="flex-1 p-2 overflow-auto">
          <div className="flex justify-center">{renderDocumentContent()}</div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
