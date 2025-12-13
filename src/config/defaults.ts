import {PluginSettings, R2S3Settings, StorageProviderType} from '../types';

const defaultR2Settings: R2S3Settings = {
    accountId: '',
    accessKeyId: '',
    secretAccessKey: '',
    bucketName: '',
    folderName: '',
    customDomain: '',
    region: 'auto'
};

export const DEFAULT_SETTINGS: PluginSettings = {
    storageProvider: StorageProviderType.CLOUDFLARE_WORKER,
    workerSettings: {
        workerUrl: '',
        apiKey: '',
        bucketName: '',
        folderName: '',
        customDomain: ''
    },
    r2S3Settings: defaultR2Settings,
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
