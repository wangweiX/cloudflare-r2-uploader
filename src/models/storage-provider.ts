import {UploadResult} from './cloudflare';

/**
 * 存储提供者类型枚举
 */
export enum StorageProviderType {
    CLOUDFLARE_WORKER = 'cloudflare_worker'
}

/**
 * 存储提供者接口 - 遵循策略模式
 */
export interface StorageProvider {
    /**
     * 获取提供者类型
     */
    getType(): StorageProviderType;

    /**
     * 上传文件
     */
    uploadFile(filePath: string, fileContent: ArrayBuffer): Promise<UploadResult>;

    /**
     * 获取文件URL
     */
    getFileUrl(fileId: string): string;
} 