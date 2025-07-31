import { StorageProviderType } from './storage-provider';

/**
 * Cloudflare Worker 设置
 */
export interface CloudflareWorkerSettings {
  workerUrl: string;
  apiKey: string;
  bucketName: string;
  folderName?: string;
  customDomain?: string;
}

/**
 * R2 S3 API 设置
 */
export interface R2S3Settings {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  folderName?: string;
  customDomain?: string;
  region?: string; // R2 uses auto region, but keeping for compatibility
}

/**
 * 插件设置的数据模型
 */
export interface PluginSettings {
  // 通用设置
  storageProvider: StorageProviderType;
  
  // Cloudflare Worker 设置
  workerSettings: CloudflareWorkerSettings;
  
  // R2 S3 API 设置
  r2S3Settings?: R2S3Settings;
  
  // 自动上传设置
  enableAutoPaste: boolean;
  deleteAfterUpload: boolean;

  // 并发控制设置
  maxConcurrentUploads?: number;
  maxRetries?: number;
  retryDelay?: number;
  maxRetryDelay?: number;
  uploadTimeout?: number;

  // 日志和通知设置
  showDetailedLogs?: boolean;
  showProgressNotifications?: boolean;
}

/**
 * 插件设置的默认值
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  storageProvider: StorageProviderType.CLOUDFLARE_WORKER,
  workerSettings: {
    workerUrl: "",
    apiKey: "",
    bucketName: "",
    folderName: "",
    customDomain: ""
  },
  r2S3Settings: {
    accountId: "",
    accessKeyId: "",
    secretAccessKey: "",
    bucketName: "",
    folderName: "",
    customDomain: "",
    region: "auto"
  },
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