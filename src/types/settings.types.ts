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

/**
 * Common settings shared across all provider configurations
 */
export interface BasePluginSettings {
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

/**
 * Settings when Cloudflare Worker is the active provider.
 */
export interface WorkerProviderSettings extends BasePluginSettings {
    storageProvider: StorageProviderType.CLOUDFLARE_WORKER;
    workerSettings: CloudflareWorkerSettings;
}

/**
 * Settings when R2 S3 API is the active provider.
 */
export interface R2S3ProviderSettings extends BasePluginSettings {
    storageProvider: StorageProviderType.R2_S3_API;
    r2S3Settings: R2S3Settings;
}

/**
 * Discriminated union of all provider settings.
 * Each provider type only contains its relevant configuration.
 */
export type PluginSettings = WorkerProviderSettings | R2S3ProviderSettings;

// ===== Type Guards =====

/**
 * Type guard: Check if settings are configured for Cloudflare Worker
 */
export function isWorkerProvider(settings: PluginSettings): settings is WorkerProviderSettings {
    return settings.storageProvider === StorageProviderType.CLOUDFLARE_WORKER;
}

/**
 * Type guard: Check if settings are configured for R2 S3 API
 */
export function isR2S3Provider(settings: PluginSettings): settings is R2S3ProviderSettings {
    return settings.storageProvider === StorageProviderType.R2_S3_API;
}
