import {
    BasePluginSettings,
    CloudflareWorkerSettings,
    R2S3ProviderSettings,
    R2S3Settings,
    StorageProviderType,
    WorkerProviderSettings
} from '../types';

/**
 * Default base settings shared across all providers
 */
export const DEFAULT_BASE_SETTINGS: BasePluginSettings = {
    enableAutoPaste: false,
    deleteAfterUpload: false,
    maxConcurrentUploads: 3,
    maxRetries: 3,
    retryDelay: 1000,
    maxRetryDelay: 30000,
    uploadTimeout: 60000,
    showDetailedLogs: false,
    showProgressNotifications: true
};

/**
 * Default Cloudflare Worker settings
 */
export const DEFAULT_WORKER_SETTINGS: CloudflareWorkerSettings = {
    workerUrl: '',
    apiKey: '',
    bucketName: '',
    folderName: '',
    customDomain: ''
};

/**
 * Default R2 S3 API settings
 */
export const DEFAULT_R2S3_SETTINGS: R2S3Settings = {
    accountId: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: '',
    folderName: '',
    customDomain: '',
    region: 'auto'
};

/**
 * Default settings for Worker provider (used as initial default)
 */
export const DEFAULT_SETTINGS: WorkerProviderSettings = {
    storageProvider: StorageProviderType.CLOUDFLARE_WORKER,
    workerSettings: DEFAULT_WORKER_SETTINGS,
    ...DEFAULT_BASE_SETTINGS
};

/**
 * Create default Worker provider settings
 */
export function createWorkerSettings(base: Partial<BasePluginSettings> = {}): WorkerProviderSettings {
    return {
        storageProvider: StorageProviderType.CLOUDFLARE_WORKER,
        workerSettings: {...DEFAULT_WORKER_SETTINGS},
        ...DEFAULT_BASE_SETTINGS,
        ...base
    };
}

/**
 * Create default R2 S3 provider settings
 */
export function createR2S3Settings(base: Partial<BasePluginSettings> = {}): R2S3ProviderSettings {
    return {
        storageProvider: StorageProviderType.R2_S3_API,
        r2S3Settings: {...DEFAULT_R2S3_SETTINGS},
        ...DEFAULT_BASE_SETTINGS,
        ...base
    };
}
