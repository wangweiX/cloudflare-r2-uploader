/**
 * Upload task related types.
 */
export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled' | 'retrying';

export interface UploadError {
    type: 'network' | 'server' | 'auth' | 'timeout' | 'unknown';
    message: string;
    code?: string | number;
    details?: any;
}

export interface UploadTask {
    id: string;
    filePath: string;
    fileName: string;
    fileSize: number;
    status: UploadStatus;
    progress: number;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    uploadedSize?: number;
    speed?: number;
    retryCount?: number;
    nextRetryAt?: number;
    error?: UploadError;
    url?: string;
}

export interface UploadConfig {
    maxConcurrency: number;
    maxRetries: number;
    retryDelay: number;
    maxRetryDelay: number;
    timeout: number;
}
