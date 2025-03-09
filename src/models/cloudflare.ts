/**
 * 上传结果类型
 */
export interface UploadResult {
    success: boolean;
    localPath: string;
    imageId?: string;
    error?: string;
} 