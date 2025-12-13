/**
 * Storage provider related types.
 */
export enum StorageProviderType {
    CLOUDFLARE_WORKER = 'cloudflare_worker',
    R2_S3_API = 'r2_s3_api'
}

export interface UploadOptions {
    timeout?: number;
}

export interface UploadResult {
    url: string;
    etag?: string;
}

export interface StorageProvider {
    getType(): StorageProviderType;
    uploadImage(
        fileContent: ArrayBuffer,
        fileName: string,
        onProgress?: (progress: number) => void,
        options?: UploadOptions
    ): Promise<UploadResult>;
}
