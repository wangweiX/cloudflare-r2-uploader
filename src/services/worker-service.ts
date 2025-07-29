import * as path from 'path';
import {v4 as uuidv4} from 'uuid';
import {PluginSettings} from '../models/settings';
import {StorageProvider, StorageProviderType, UploadOptions, UploadResult} from '../models/storage-provider';
import {Logger} from '../utils/logger';

/**
 * Cloudflare Worker服务 - 负责处理与Cloudflare Worker的通信
 * 实现了StorageProvider接口，遵循策略模式
 */
export class CloudflareWorkerService implements StorageProvider {
    private logger: Logger;

    /**
     * 构造函数
     */
    constructor(private settings: PluginSettings) {
        this.logger = Logger.getInstance();
    }

    /**
     * 获取提供者类型
     */
    public getType(): StorageProviderType {
        return StorageProviderType.CLOUDFLARE_WORKER;
    }

    /**
     * 上传图片到Cloudflare Worker
     */
    public async uploadImage(
        fileContent: ArrayBuffer,
        fileName: string,
        onProgress?: (progress: number) => void,
        options?: UploadOptions
    ): Promise<UploadResult> {
        try {
            const {workerUrl, apiKey, bucketName, folderName, customDomain} = this.settings.workerSettings;

            if (!workerUrl || !apiKey) {
                throw new Error('Worker URL或API Key未配置');
            }

            // 生成唯一文件名防止覆盖
            const uniqueFileName = this.generateUniqueFileName(fileName);
            
            // 构建完整的文件路径
            // 确保folderName不以/结尾，避免双斜杠
            const cleanFolderName = folderName ? folderName.replace(/\/$/, '') : '';
            const filePath = cleanFolderName ? `${cleanFolderName}/${uniqueFileName}` : uniqueFileName;

            // 获取文件的MIME类型
            const mimeType = this.getMimeType(fileName);
            this.logger.info(`上传文件: ${fileName} -> ${filePath}, 类型: ${mimeType}`);

            // 构建上传URL（使用POST方法）
            // 对文件路径的各个部分进行编码，但保留/作为路径分隔符
            const encodedFilePath = filePath.split('/').map(part => encodeURIComponent(part)).join('/');
            const uploadUrl = `${workerUrl}/api/v1/buckets/${bucketName}/files/${encodedFilePath}`;
            this.logger.info(`上传URL: ${uploadUrl}`);

            // 创建上传请求
            const controller = new AbortController();
            const timeoutId = options?.timeout ? setTimeout(() => controller.abort(), options.timeout) : null;

            try {
                // 模拟进度（因为Fetch API不支持上传进度）
                if (onProgress) {
                    onProgress(0.1); // 开始上传
                }

                const response = await fetch(uploadUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Content-Type': mimeType,
                        'Content-Length': fileContent.byteLength.toString()
                    },
                    body: fileContent,
                    signal: controller.signal
                });

                if (timeoutId) clearTimeout(timeoutId);

                // 模拟进度
                if (onProgress) {
                    onProgress(0.9); // 上传完成，等待响应
                }

                // 解析响应
                const json = await response.json();

                if (response.ok && json.success) {
                    // 构建访问URL
                    let imageUrl: string;
                    if (customDomain && customDomain.trim() !== '') {
                        // 使用自定义域名
                        const domainBase = customDomain.startsWith('http') ? customDomain : `https://${customDomain}`;
                        const formattedDomain = domainBase.endsWith('/') ? domainBase.slice(0, -1) : domainBase;
                        imageUrl = `${formattedDomain}/${filePath}`;
                    } else {
                        // 使用Worker URL
                        const baseUrl = new URL(workerUrl);
                        imageUrl = `${baseUrl.origin}/${filePath}`;
                    }

                    if (onProgress) {
                        onProgress(1); // 完成
                    }

                    this.logger.info(`文件上传成功: ${fileName} -> ${imageUrl}`);
                    return {
                        url: imageUrl,
                        etag: json.etag
                    };
                } else {
                    const errorMessage = json.error || response.statusText || '未知错误';
                    this.logger.error(`上传失败响应: ${response.status} ${response.statusText}`, json);
                    throw new Error(errorMessage);
                }
            } catch (error: any) {
                if (timeoutId) clearTimeout(timeoutId);
                
                if (error.name === 'AbortError') {
                    throw {
                        type: 'timeout',
                        message: '上传超时',
                        code: 'TIMEOUT'
                    };
                }
                
                throw error;
            }
        } catch (error: any) {
            this.logger.error(`上传文件失败 ${fileName}:`, error);
            
            // 规范化错误
            if (error.type) {
                throw error;
            }

            // 分析错误类型
            let type: 'network' | 'server' | 'auth' | 'timeout' | 'unknown' = 'unknown';
            const message = error.message || String(error);

            if (message.includes('Worker URL或API Key未配置')) {
                type = 'auth';
            } else if (message.includes('Failed to fetch') || message.includes('网络')) {
                type = 'network';
            } else if (error.status && error.status >= 500) {
                type = 'server';
            }

            throw {
                type,
                message,
                code: error.code || error.status
            };
        }
    }

    /**
     * 生成唯一文件名
     */
    private generateUniqueFileName(originalName: string): string {
        const ext = path.extname(originalName);
        const baseName = path.basename(originalName, ext)
            .replace(/[^a-zA-Z0-9\u4e00-\u9fa5_\-\.]/g, '_'); // 替换不支持的字符为下划线，注意转义-和.
        const timestamp = new Date().getTime();
        const randomId = uuidv4().split('-')[0]; // 使用UUID的前8位
        return `${baseName}_${timestamp}_${randomId}${ext}`;
    }

    /**
     * 根据文件扩展名获取MIME类型
     */
    private getMimeType(fileName: string): string {
        const extension = path.extname(fileName).toLowerCase().replace('.', '');
        const mimeTypes: { [key: string]: string } = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'svg': 'image/svg+xml',
            'bmp': 'image/bmp',
            'ico': 'image/x-icon',
            'tiff': 'image/tiff',
            'tif': 'image/tiff'
        };
        return mimeTypes[extension] || 'application/octet-stream';
    }
}