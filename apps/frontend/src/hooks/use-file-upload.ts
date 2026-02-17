"use client";

import { useState } from "react";
import {
  TABLE_NAMES,
  type BatchUploadResult,
  type UploadProgress
} from "@packages/types";
import { apiPost } from "@/lib/api";

export function useFileUpload() {
  const [uploads, setUploads] = useState<UploadProgress[]>([]);

  const clearUploads = () => {
    setUploads([]);
  };

  const retryFailedUpload = async (fileName: string) => {
    const failedUpload = uploads.find(
      (u) => u.fileName === fileName && u.status === "error"
    );
    if (!failedUpload) return;

    // Find the original file (this would need to be stored somewhere)
    // For now, we'll just reset the status - in a real app you'd need to store the File objects
    setUploads((prev) =>
      prev.map((upload) =>
        upload.fileName === fileName
          ? { ...upload, status: "uploading", progress: 0, error: undefined }
          : upload
      )
    );

    // Here you would re-attempt the upload process
    // This is a simplified version - you'd need to store the original File objects
  };

  const uploadFilesBatch = async (
    files: File[],
    projectId: string
  ): Promise<BatchUploadResult> => {
    // Initialize upload progress for all files
    setUploads(
      files.map((file) => ({
        fileName: file.name,
        progress: 0,
        status: "uploading"
      }))
    );

    const fileData: Array<{
      name: string;
      fileType: string;
      s3Key: string;
      fileSize: number;
      fileHash: string;
    }> = [];

    // Step 1: Upload all files to S3 first
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        // Get presigned upload URL
        const uploadUrlResponse = await apiPost(
          `/${TABLE_NAMES.DATA_LAYERS}/upload-url`,
          {
            fileName: file.name,
            contentType: file.type,
            projectId
          }
        );

        if (!uploadUrlResponse.ok) {
          throw new Error("Failed to get upload URL");
        }

        const { uploadUrl, s3Key } = await uploadUrlResponse.json();

        // Upload file directly to S3
        const uploadResponse = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": file.type
          }
        });

        if (!uploadResponse.ok) {
          throw new Error(`Upload failed: ${uploadResponse.statusText}`);
        }

        // Update progress
        setUploads((prev) =>
          prev.map((upload) =>
            upload.fileName === file.name
              ? { ...upload, progress: 80, status: "uploading" } // 80% for S3 upload
              : upload
          )
        );

        fileData.push({
          name: file.name,
          fileType: getFileType(file.type),
          s3Key,
          fileSize: file.size,
          fileHash: await calculateFileHash(file)
        });
      } catch (error) {
        setUploads((prev) =>
          prev.map((upload) =>
            upload.fileName === file.name
              ? {
                  ...upload,
                  status: "error",
                  error:
                    error instanceof Error ? error.message : "Upload failed"
                }
              : upload
          )
        );
      }
    }

    // Step 2: Create all data layer records in a single batch
    try {
      const batchResponse = await apiPost(
        `/${TABLE_NAMES.DATA_LAYERS}/batch-upload`,
        {
          projectId,
          files: fileData
        }
      );

      if (!batchResponse.ok) {
        throw new Error("Failed to create data layer records");
      }

      const result = await batchResponse.json();

      // Update all successful uploads to completed
      fileData.forEach((file) => {
        setUploads((prev) =>
          prev.map((upload) =>
            upload.fileName === file.name
              ? { ...upload, progress: 100, status: "completed" }
              : upload
          )
        );
      });

      return {
        dataLayerIds: result.dataLayers.map((dl: { id: string }) => dl.id),
        totalUploaded: result.totalUploaded,
        errors: result.errors
      };
    } catch (err) {
      // Mark all as error
      fileData.forEach((file) => {
        setUploads((prev) =>
          prev.map((upload) =>
            upload.fileName === file.name
              ? {
                  ...upload,
                  status: "error",
                  error:
                    err instanceof Error ? err.message : "Batch upload failed"
                }
              : upload
          )
        );
      });

      throw err;
    }
  };

  const startExtractionJob = async (
    dataLayerIds: string[],
    schemaId?: string
  ): Promise<{
    jobId: string;
    status: string;
    message: string;
  }> => {
    const response = await apiPost("/extraction/job", {
      dataLayerIds,
      jobType: "material_extraction",
      schemaId: schemaId
    });

    if (!response.ok) {
      throw new Error("Failed to start extraction job");
    }

    const result = await response.json();

    // Log job creation for debugging
    console.log(`[file-upload] Started extraction job: ${result.jobId}`);

    return {
      jobId: result.jobId || result.id,
      status: result.status || "queued",
      message: result.message || "Extraction job started successfully"
    };
  };

  return {
    uploads,
    uploadFilesBatch,
    startExtractionJob,
    clearUploads,
    retryFailedUpload
  };
}

// Helper functions
function getFileType(mimeType: string): string {
  if (mimeType === "application/pdf") return "pdf";
  if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  )
    return "docx";
  if (mimeType.startsWith("image/")) return "image";
  return "other";
}

async function calculateFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
