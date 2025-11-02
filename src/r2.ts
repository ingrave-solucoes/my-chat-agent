/**
 * R2 Storage Manager
 * Handles file operations with Cloudflare R2 bucket
 */

export interface R2UploadOptions {
  key: string;
  data: ReadableStream | ArrayBuffer | string;
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface R2FileInfo {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

/**
 * R2 Storage client for managing files in Cloudflare R2
 */
export class R2StorageManager {
  constructor(private bucket: R2Bucket) {}

  /**
   * Upload a file to R2 bucket
   */
  async upload(options: R2UploadOptions): Promise<R2FileInfo> {
    const { key, data, contentType, metadata } = options;

    const uploadOptions: R2PutOptions = {
      httpMetadata: contentType
        ? {
            contentType
          }
        : undefined,
      customMetadata: metadata
    };

    await this.bucket.put(key, data, uploadOptions);

    // Get the uploaded file info
    const object = await this.bucket.head(key);
    if (!object) {
      throw new Error(`Failed to upload file: ${key}`);
    }

    return this.objectToFileInfo(object, key);
  }

  /**
   * Download a file from R2 bucket
   */
  async download(key: string): Promise<R2ObjectBody | null> {
    return await this.bucket.get(key);
  }

  /**
   * Get file metadata without downloading
   */
  async getFileInfo(key: string): Promise<R2FileInfo | null> {
    const object = await this.bucket.head(key);
    if (!object) {
      return null;
    }

    return this.objectToFileInfo(object, key);
  }

  /**
   * Delete a file from R2 bucket
   */
  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  /**
   * List files in the bucket with optional prefix
   */
  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    files: R2FileInfo[];
    truncated: boolean;
    cursor?: string;
  }> {
    const listed = await this.bucket.list({
      prefix: options?.prefix,
      limit: options?.limit,
      cursor: options?.cursor
    });

    const files = listed.objects.map((obj) =>
      this.objectToFileInfo(obj, obj.key)
    );

    return {
      files,
      truncated: listed.truncated,
      cursor: listed.cursor
    };
  }

  /**
   * Check if a file exists
   */
  async exists(key: string): Promise<boolean> {
    const object = await this.bucket.head(key);
    return object !== null;
  }

  /**
   * Get a signed URL for direct upload (if needed for future implementation)
   */
  async getSignedUrl(
    key: string,
    expiresIn: number = 3600
  ): Promise<string | null> {
    // R2 doesn't have built-in signed URLs like S3
    // You would need to implement this using a Worker route
    // For now, return null
    return null;
  }

  /**
   * Convert R2 object to FileInfo
   */
  private objectToFileInfo(
    object: R2Object,
    key: string
  ): R2FileInfo {
    return {
      key,
      size: object.size,
      uploaded: object.uploaded,
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata
    };
  }
}

/**
 * Helper function to generate unique file keys
 */
export function generateFileKey(
  filename: string,
  prefix?: string
): string {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 15);
  const cleanFilename = filename.replace(/[^a-zA-Z0-9.-]/g, "_");

  if (prefix) {
    return `${prefix}/${timestamp}-${randomStr}-${cleanFilename}`;
  }

  return `${timestamp}-${randomStr}-${cleanFilename}`;
}

/**
 * Helper function to get file extension
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split(".");
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
}

/**
 * Helper function to get content type from file extension
 */
export function getContentType(filename: string): string {
  const ext = getFileExtension(filename);
  const contentTypes: Record<string, string> = {
    // Images
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",

    // Documents
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",

    // Video
    mp4: "video/mp4",
    webm: "video/webm",

    // Text
    txt: "text/plain",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    json: "application/json",

    // Archives
    zip: "application/zip",
    tar: "application/x-tar",
    gz: "application/gzip"
  };

  return contentTypes[ext] || "application/octet-stream";
}
