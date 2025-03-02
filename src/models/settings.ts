import { StorageProviderType } from './storage-provider';

/**
 * 插件设置的数据模型
 */
export interface PluginSettings {
  // 通用设置
  storageProvider: StorageProviderType;
  
  // Cloudflare Worker 设置
  workerSettings: {
    workerUrl: string;
    apiKey: string;
    folderName?: string;
    customDomain?: string;
  };
  
  // 自动上传设置
  enableAutoPaste: boolean;
}

/**
 * 插件设置的默认值
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  storageProvider: StorageProviderType.CLOUDFLARE_WORKER,
  workerSettings: {
    workerUrl: "",
    apiKey: "",
    folderName: "",
    customDomain: ""
  },
  enableAutoPaste: false
}; 