import {Notice, requestUrl, RequestUrlParam} from 'obsidian';
import * as path from 'path';
import {v4 as uuidv4} from 'uuid';
import {PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {UploadResult} from '../models/cloudflare';
import {R2Config, StorageProvider, StorageProviderType} from '../models/storage-provider';
import {Logger} from '../utils/logger';
import {NodeHttpHandler} from '@aws-sdk/node-http-handler';

/**
 * Cloudflare R2服务 - 负责处理与Cloudflare R2存储的通信
 * 实现了StorageProvider接口，遵循策略模式
 */
export class R2Service implements StorageProvider {
    private logger: Logger;
    private s3Client: S3Client;

    /**
     * 构造函数
     */
    constructor(private config: R2Config) {
        this.logger = Logger.getInstance();

        // 判断是否提供了 S3 API 凭证
        const hasS3Credentials = !!(config.accessKeyId && config.secretAccessKey);

        if (!hasS3Credentials) {
            this.logger.error('未提供 S3 API 凭证');
            new Notice(`未提供 S3 API 凭证`, 3000);
        }

        // 创建 S3Client 实例
        this.s3Client = new S3Client({
            region: 'auto', // Cloudflare R2 使用 'auto' 作为区域
            endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: config.accessKeyId || '',
                secretAccessKey: config.secretAccessKey || '',
            },
            // 添加自定义配置以处理 CORS 问题
            forcePathStyle: true, // 使用路径样式而不是虚拟主机样式
            // 添加以下配置尝试解决连接问题
            requestHandler: new NodeHttpHandler({
                connectionTimeout: 5000,  // 5秒连接超时
                socketTimeout: 10000      // 10秒socket超时
            })
        });

        // 检查配置
        this.checkR2Configuration();
    }

    /**
     * 检查 R2 配置并提供帮助
     */
    private checkR2Configuration() {
        // 提示用户确认配置
        this.logger.info('检查 R2 配置...');
        this.logger.info('已启用多种上传策略，将自动尝试最佳上传方式');
    }

    /**
     * 获取提供者类型
     */
    public getType(): StorageProviderType {
        return StorageProviderType.CLOUDFLARE_R2;
    }

    /**
     * 使用多种策略上传文件到R2存储桶
     */
    public async uploadFile(filePath: string, fileContent: ArrayBuffer): Promise<UploadResult> {
        try {
            // 获取文件信息
            const fileName = path.basename(filePath);
            const fileExt = path.extname(fileName);

            // 生成唯一文件名
            const uniqueId = uuidv4();
            const objectKey = `images/${uniqueId}${fileExt}`;

            this.logger.info(`开始上传文件 filePath: ${filePath}`);
            this.logger.info(`开始上传文件 fileName: ${fileName}`);
            this.logger.info(`开始上传文件 objectKey: ${objectKey}`);

            // 判断是否提供了 S3 API 凭证
            const hasS3Credentials = !!(this.config.accessKeyId && this.config.secretAccessKey);

            if (!hasS3Credentials) {
                throw new Error('未提供 S3 API 凭证');
            }

            // 尝试所有上传方法，直到成功
            // 顺序：1. Obsidian requestUrl API, 2. 预签名URL, 3. 直接上传
            try {
                // 尝试使用 Obsidian requestUrl API 上传
                return await this.uploadWithObsidian(objectKey, fileName, filePath, fileContent, fileExt);
            } catch (obsidianError) {
                this.logger.warn(`Obsidian API 上传失败，尝试预签名 URL: ${(obsidianError as Error).message}`);

                try {
                    // 尝试预签名 URL 上传
                    return await this.uploadWithPresignedUrl(objectKey, fileName, filePath, fileContent, fileExt);
                } catch (presignedUrlError) {
                    // 如果预签名 URL 方法失败，记录错误并尝试直接上传方法
                    this.logger.warn(`预签名 URL 上传失败，尝试直接上传: ${(presignedUrlError as Error).message}`);
                    return await this.uploadDirectly(objectKey, fileName, filePath, fileContent, fileExt);
                }
            }

        } catch (error) {
            // 增强错误日志
            this.logger.error(`上传失败详细信息:`, {
                error: (error as Error).message,
                stack: (error as Error).stack,
                config: {
                    accountId: this.config.accountId,
                    bucket: this.config.bucket,
                    // 不要记录完整的访问密钥，只记录前几个字符
                    accessKeyIdPrefix: this.config.accessKeyId?.substring(0, 4) + '***',
                    hasSecretKey: !!this.config.secretAccessKey
                }
            });

            this.logger.error(`处理文件时出错 ${filePath}:`, error);

            // 检查是否为特定错误类型
            const errorMsg = (error as Error).message;
            if (errorMsg.includes('SSL') || errorMsg.includes('TLS') || errorMsg.includes('CIPHER_MISMATCH')) {
                this.logger.error('SSL/TLS 连接错误，请检查您的网络连接和 Cloudflare 配置');
                new Notice(`SSL 错误: 无法安全连接到 Cloudflare R2，请检查您的网络设置`, 5000);
            } else if (errorMsg.includes('CORS')) {
                this.logger.error('CORS 问题');
                new Notice(`CORS 错误: 请联系插件开发者`, 5000);
            } else {
                new Notice(`处理文件出错: ${path.basename(filePath)}`, 3000);
            }

            return {
                success: false,
                localPath: filePath,
                error: (error as Error).message
            };
        }
    }

    /**
     * 使用 Obsidian requestUrl API 上传文件（最优先尝试）
     * 这种方法可以绕过浏览器的 CORS 和 SSL 限制
     * @private
     */
    private async uploadWithObsidian(
        objectKey: string,
        fileName: string,
        filePath: string,
        fileContent: ArrayBuffer,
        fileExt: string
    ): Promise<UploadResult> {
        this.logger.info(`尝试使用 Obsidian API 上传: ${fileName} -> ${objectKey}`);

        // 生成预签名URL
        const presignedUrl = await this.getPresignedUrl(
            objectKey,
            'put',
            900, // 15分钟
            this.getMimeType(fileExt)
        );

        // 将 ArrayBuffer 转换为 Uint8Array
        const fileBuffer = new Uint8Array(fileContent);

        // 准备请求参数
        const requestParams: RequestUrlParam = {
            url: presignedUrl,
            method: 'PUT',
            headers: {
                'Content-Type': this.getMimeType(fileExt)
            },
            body: fileBuffer
        };

        // 使用 Obsidian requestUrl API 发送请求
        const response = await requestUrl(requestParams);

        // 检查响应状态
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Obsidian API 上传失败，状态码: ${response.status}`);
        }

        this.logger.info(`文件通过 Obsidian API 上传成功: ${fileName} -> ${objectKey}`);

        return {
            success: true,
            localPath: filePath,
            imageId: objectKey
        };
    }

    /**
     * 使用预签名 URL 上传文件（次优先）
     * @private
     */
    private async uploadWithPresignedUrl(
        objectKey: string,
        fileName: string,
        filePath: string,
        fileContent: ArrayBuffer,
        fileExt: string
    ): Promise<UploadResult> {
        this.logger.info(`尝试使用预签名 URL 上传: ${fileName} -> ${objectKey}`);

        // 创建用于生成预签名URL的命令
        const command = new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: objectKey,
            ContentType: this.getMimeType(fileExt)
        });

        // 生成预签名URL (有效期15分钟)
        const presignedUrl = await getSignedUrl(this.s3Client, command, {
            expiresIn: 900 // 15分钟(秒数)
        });

        this.logger.info(`已生成预签名URL，准备上传...`);

        // 将 ArrayBuffer 转换为 Uint8Array
        const fileBuffer = new Uint8Array(fileContent);

        try {
            // 添加自定义 fetch 选项以尝试解决 SSL/TLS 问题
            // 注意：这些选项在某些浏览器环境下可能无效，但值得尝试
            const fetchOptions: RequestInit = {
                method: 'PUT',
                headers: {
                    'Content-Type': this.getMimeType(fileExt)
                },
                body: fileBuffer,
                mode: 'cors',
                cache: 'no-cache',
                redirect: 'follow',
                // 在某些环境下，可能会使用一些非标准的 fetch 选项
                // 例如 Electron 环境中可能支持一些额外选项
                // @ts-ignore
                credentials: 'omit',
                // @ts-ignore
                rejectUnauthorized: false // 尝试忽略 SSL 错误，在某些环境下有效
            };

            // 使用预签名URL上传文件
            const response = await fetch(presignedUrl, fetchOptions);

            if (!response.ok) {
                throw new Error(`预签名URL上传失败，状态码: ${response.status}, 原因: ${await response.text()}`);
            }

            this.logger.info(`文件通过预签名URL上传成功: ${fileName} -> ${objectKey}`);
            return {
                success: true,
                localPath: filePath,
                imageId: objectKey
            };
        } catch (error) {
            // 检测特定的 SSL 错误
            const errorMsg = (error as Error).message;
            if (errorMsg.includes('ERR_SSL_VERSION_OR_CIPHER_MISMATCH')) {
                throw new Error(`SSL 版本或加密套件不匹配: ${errorMsg}`);
            }
            throw error;
        }
    }

    /**
     * 直接使用 AWS SDK 上传文件（最后尝试）
     * @private
     */
    private async uploadDirectly(
        objectKey: string,
        fileName: string,
        filePath: string,
        fileContent: ArrayBuffer,
        fileExt: string
    ): Promise<UploadResult> {
        this.logger.info(`尝试使用直接上传方法: ${fileName} -> ${objectKey}`);

        // 将 ArrayBuffer 转换为 Uint8Array
        const fileBuffer = new Uint8Array(fileContent);

        // 使用 AWS SDK 创建上传命令
        const command = new PutObjectCommand({
            Bucket: this.config.bucket,
            Key: objectKey,
            Body: fileBuffer,
            ContentType: this.getMimeType(fileExt)
        });

        // 执行上传
        await this.s3Client.send(command);

        this.logger.info(`文件直接上传成功: ${fileName} -> ${objectKey}`);
        return {
            success: true,
            localPath: filePath,
            imageId: objectKey
        };
    }

    /**
     * 生成预签名URL (公共方法，可在其他场景使用)
     * @param objectKey 对象键
     * @param operation 操作类型 ('put' | 'get')
     * @param expiresIn 过期时间(秒)
     * @param contentType 内容类型
     */
    public async getPresignedUrl(
        objectKey: string,
        operation: 'put' | 'get' = 'get',
        expiresIn: number = 3600,
        contentType?: string
    ): Promise<string> {
        try {
            const command = new PutObjectCommand({
                Bucket: this.config.bucket,
                Key: objectKey,
                ContentType: contentType
            });

            const presignedUrl = await getSignedUrl(this.s3Client, command, {
                expiresIn: expiresIn
            });

            return presignedUrl;
        } catch (error) {
            this.logger.error(`生成预签名URL出错:`, error);
            throw error;
        }
    }

    /**
     * 获取R2文件的URL
     */
    public getFileUrl(objectKey: string): string {
        const {accountId, bucket, customDomain} = this.config;

        // 如果设置了自定义域名，使用自定义域名
        if (customDomain) {
            return `${customDomain}/${objectKey}`;
        }

        // 否则使用Cloudflare默认R2域名，同样更新为与上传一致的URL结构
        return `https://${bucket}.${accountId}.r2.cloudflarestorage.com/${objectKey}`;
    }

    /**
     * 根据文件扩展名获取MIME类型
     */
    private getMimeType(ext: string): string {
        const mimeMap: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml',
            '.pdf': 'application/pdf',
            '.md': 'text/markdown'
        };

        return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
    }
} 