/**
 * 上传任务相关的类型定义
 */

/**
 * 上传任务状态
 */
export type UploadStatus = 'pending' | 'uploading' | 'completed' | 'failed' | 'cancelled' | 'retrying';

/**
 * 上传错误
 */
export interface UploadError {
    type: 'network' | 'server' | 'auth' | 'timeout' | 'unknown';
    message: string;
    code?: string | number;
    details?: any;
}

/**
 * 上传任务
 */
export interface UploadTask {
    id: string;                    // 任务ID
    filePath: string;              // 文件路径
    fileName: string;              // 文件名
    fileSize: number;              // 文件大小
    status: UploadStatus;          // 任务状态
    progress: number;              // 上传进度 (0-1)
    createdAt: number;             // 创建时间戳
    startedAt?: number;            // 开始时间戳
    completedAt?: number;          // 完成时间戳
    uploadedSize?: number;         // 已上传字节数
    speed?: number;                // 上传速度 (bytes/s)
    retryCount?: number;           // 重试次数
    nextRetryAt?: number;          // 下次重试时间戳
    error?: UploadError;           // 错误信息
    url?: string;                  // 上传成功后的URL
}

/**
 * 上传配置
 */
export interface UploadConfig {
    maxConcurrency: number;        // 最大并发数
    maxRetries: number;            // 最大重试次数
    retryDelay: number;            // 初始重试延迟（毫秒）
    maxRetryDelay: number;         // 最大重试延迟（毫秒）
    timeout: number;               // 上传超时（毫秒）
}