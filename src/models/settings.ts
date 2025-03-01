import { StorageProviderType } from './storage-provider';

/**
 * 插件设置的数据模型
 */
export interface PluginSettings {
  // 通用设置
  storageProvider: StorageProviderType;
  
  // Cloudflare Images 设置
  accountId: string;
  apiToken: string;
  
  // Cloudflare R2 设置
  r2Settings: {
    accountId: string;
    apiToken: string;
    bucket: string;
    customDomain?: string;
  };
  
  // 自动上传设置
  enableAutoPaste: boolean;
}

/**
 * 插件设置的默认值
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  storageProvider: StorageProviderType.CLOUDFLARE_IMAGES,
  accountId: "",
  apiToken: "",
  r2Settings: {
    accountId: "",
    apiToken: "", 
    bucket: ""
  },
  enableAutoPaste: false
}; 