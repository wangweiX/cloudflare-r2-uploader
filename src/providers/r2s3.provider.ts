import {S3Client, PutObjectCommand, PutObjectCommandInput} from '@aws-sdk/client-s3';
import {R2S3Settings, StorageProvider, StorageProviderType, UploadOptions, UploadResult} from '../types';
import {Logger, generateUniqueFileName, getMimeType} from '../utils';
import {BaseStorageProvider} from '../providers';

/**
 * R2 S3 API 服务 - 直接使用 Cloudflare R2 的 S3 兼容 API
 * 实现了 StorageProvider 接口，遵循策略模式
 */
export class R2S3Service extends BaseStorageProvider implements StorageProvider {
    private logger: Logger;
    private s3Client: S3Client;

    /**
     * 构造函数
     */
    constructor(private settings: R2S3Settings) {
        super();
        this.logger = Logger.getInstance();
        
        // 创建 S3 客户端
        this.s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: settings.accessKeyId,
                secretAccessKey: settings.secretAccessKey,
            },
            // R2 需要使用 path-style 访问
            forcePathStyle: true,
        });
    }

    /**
     * 获取提供者类型
     */
    public getType(): StorageProviderType {
        return StorageProviderType.R2_S3_API;
    }

    /**
     * 上传图片到 R2
     */
    public async uploadImage(
        fileContent: ArrayBuffer,
        fileName: string,
        onProgress?: (progress: number) => void,
        options?: UploadOptions
    ): Promise<UploadResult> {
        try {
            const {bucketName, folderName, customDomain} = this.settings;

            if (!bucketName) {
                throw new Error('R2 S3 API 配置不完整：缺少存储桶名称');
            }

            // 生成唯一文件名防止覆盖
            const uniqueFileName = generateUniqueFileName(fileName);
            const filePath = this.buildFilePath(folderName, uniqueFileName);

            // 获取文件的MIME类型
            const mimeType = getMimeType(fileName);
            this.logger.info(`上传文件: ${fileName} -> ${filePath}, 类型: ${mimeType}`);

            // 准备上传参数
            const uploadParams: PutObjectCommandInput = {
                Bucket: bucketName,
                Key: filePath,
                Body: new Uint8Array(fileContent),
                ContentType: mimeType,
                ContentLength: fileContent.byteLength,
            };

            // 模拟进度回调
            if (onProgress) {
                onProgress(0.1); // 开始上传
            }

            // 创建 AbortController 用于超时控制
            const abortController = new AbortController();
            const timeoutId = options?.timeout 
                ? setTimeout(() => abortController.abort(), options.timeout) 
                : null;

            try {
                // 使用 AWS SDK 上传文件
                const command = new PutObjectCommand(uploadParams);
                const response = await this.s3Client.send(command, {
                    abortSignal: abortController.signal
                });

                if (timeoutId) clearTimeout(timeoutId);

                // 模拟进度
                if (onProgress) {
                    onProgress(0.9); // 上传完成，等待响应
                }

                // 构建访问URL
                const fallbackBase = `https://${this.settings.accountId}.r2.cloudflarestorage.com/${bucketName}`;
                const imageUrl = this.buildPublicUrl(customDomain, filePath, fallbackBase);

                if (onProgress) {
                    onProgress(1); // 完成
                }

                this.logger.info(`文件上传成功: ${fileName} -> ${imageUrl}`);
                return {
                    url: imageUrl,
                    etag: response.ETag
                };
                
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
            const errorName = error.name || '';

            if (errorName === 'CredentialsProviderError' || 
                errorName === 'InvalidSignatureException' ||
                message.includes('配置不完整') || 
                message.includes('403') || 
                message.includes('Access Denied')) {
                type = 'auth';
            } else if (errorName === 'NetworkError' || 
                       message.includes('Failed to fetch') || 
                       message.includes('网络') ||
                       message.includes('CORS')) {
                // CORS 错误通常是暂时的，标记为网络错误以便重试
                type = 'network';
            } else if (error.$metadata?.httpStatusCode && error.$metadata.httpStatusCode >= 500) {
                type = 'server';
            }

            throw {
                type,
                message,
                code: error.Code || error.name || error.$metadata?.httpStatusCode
            };
        }
    }

}
