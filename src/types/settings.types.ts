import {StorageProviderType} from './storage.types';

export interface CloudflareWorkerSettings {
    workerUrl: string;
    apiKey: string;
    bucketName: string;
    folderName?: string;
    customDomain?: string;
}

export interface R2S3Settings {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
    folderName?: string;
    customDomain?: string;
    region?: string;
}

export interface PluginSettings {
    storageProvider: StorageProviderType;
    workerSettings: CloudflareWorkerSettings;
    r2S3Settings?: R2S3Settings;
    enableAutoPaste: boolean;
    deleteAfterUpload: boolean;
    maxConcurrentUploads?: number;
    maxRetries?: number;
    retryDelay?: number;
    maxRetryDelay?: number;
    uploadTimeout?: number;
    showDetailedLogs?: boolean;
    showProgressNotifications?: boolean;
}
