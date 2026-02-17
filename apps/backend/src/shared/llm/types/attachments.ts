export interface Attachment {
  data?: string; // base64
  s3Url?: string; // S3 URL
  buffer?: Buffer; // raw buffer
  mimeType: string;
}
