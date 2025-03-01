/**
 * Cloudflare API响应接口
 */
export interface CloudflareApiResponse<T> {
    success: boolean;
    errors: { message: string }[];
    result?: T;
}

/**
 * Cloudflare图片上传结果
 */
export interface CloudflareImageResult {
    id: string;
    variants: string[];
    uploaded: string;
}

/**
 * 上传结果类型
 */
export interface UploadResult {
    success: boolean;
    localPath: string;
    imageId?: string;
    error?: string;
} 