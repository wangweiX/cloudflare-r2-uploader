/**
 * 存储提供者类型枚举
 */
export enum StorageProviderType {
    CLOUDFLARE_WORKER = 'cloudflare_worker',
    R2_S3_API = 'r2_s3_api'
}

/**
 * 上传选项
 */
export interface UploadOptions {
    timeout?: number;  // 超时时间（毫秒）
}

/**
 * 上传结果
 */
export interface UploadResult {
    url: string;      // 上传后的URL
    etag?: string;    // 文件标识
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
     * 上传图片
     * @param fileContent 文件内容
     * @param fileName 文件名
     * @param onProgress 进度回调 (0-1)
     * @param options 上传选项
     */
    uploadImage(
        fileContent: ArrayBuffer,
        fileName: string,
        onProgress?: (progress: number) => void,
        options?: UploadOptions
    ): Promise<UploadResult>;
} 