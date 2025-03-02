import {Notice} from 'obsidian';
import * as path from 'path';
import {v4 as uuidv4} from 'uuid';
import {PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {UploadResult} from '../models/cloudflare';
import {R2Config, StorageProvider, StorageProviderType} from '../models/storage-provider';
import {Logger} from '../utils/logger';
// 删除未安装的中间件相关导入
// import {HttpRequest} from '@aws-sdk/protocol-http';
// import {Middleware, MiddlewareStack} from '@aws-sdk/smithy-client';

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
        });

        // 检查是否已配置 CORS
        this.checkR2Configuration();
    }

    /**
     * 检查 R2 配置并提供帮助
     */
    private checkR2Configuration() {
        // 提示用户确认 CORS 配置
        this.logger.info('检查 R2 配置...');
        this.logger.info('请确保您已在 Cloudflare R2 控制面板中配置了 CORS 策略');
        
        // 提示用户查看 CORS 配置帮助
        this.logCorsConfigHelp();
    }

    /**
     * 获取提供者类型
     */
    public getType(): StorageProviderType {
        return StorageProviderType.CLOUDFLARE_R2;
    }

    /**
     * 上传文件到R2存储桶
     */
    public async uploadFile(filePath: string, fileContent: ArrayBuffer): Promise<UploadResult> {
        try {
            // 获取文件信息
            const fileName = path.basename(filePath);
            const fileExt = path.extname(fileName);

            // 生成唯一文件名
            const uniqueId = uuidv4();
            const objectKey = `images/${uniqueId}${fileExt}`;

            // 使用 AWS SDK 上传
            this.logger.info(`开始使用 S3 API 上传文件 filePath: ${filePath}`);
            this.logger.info(`开始使用 S3 API 上传文件 fileName: ${fileName}`);
            this.logger.info(`开始使用 S3 API 上传文件 objectKey: ${objectKey}`);

            // 判断是否提供了 S3 API 凭证
            const hasS3Credentials = !!(this.config.accessKeyId && this.config.secretAccessKey);

            if (!hasS3Credentials) {
                throw new Error('未提供 S3 API 凭证');
            }

            // 将 ArrayBuffer 转换为 Uint8Array
            const fileBuffer = new Uint8Array(fileContent);

            // 使用 AWS SDK 创建上传命令 - 添加额外的参数来处理 CORS
            const command = new PutObjectCommand({
                Bucket: this.config.bucket,
                Key: objectKey,
                Body: fileBuffer, // 使用 Uint8Array 格式的数据
                ContentType: this.getMimeType(fileExt),
                // 添加 Metadata 以设置特定的 CORS 相关信息
                Metadata: {
                    'x-amz-meta-origin': 'app://obsidian.md',
                    'x-amz-meta-app': 'obsidian-cloudflare-uploader'
                }
            });

            // 执行上传
            await this.s3Client.send(command);

            this.logger.info(`文件上传到R2成功: ${fileName} -> ${objectKey}`);
            return {
                success: true,
                localPath: filePath,
                imageId: objectKey
            };

        } catch (error) {
            this.logger.error(`处理文件时出错 ${filePath}:`, error);
            
            // 检查是否为 CORS 相关错误
            const errorMsg = (error as Error).message;
            if (errorMsg.includes('CORS')) {
                this.logger.error('可能存在 CORS 配置问题，请检查 R2 存储桶的 CORS 设置');
                new Notice(`CORS 错误: 请确保已为 R2 存储桶配置正确的 CORS 策略`, 5000);
                
                // 提供配置 CORS 的帮助信息
                this.logCorsConfigHelp();
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

    /**
     * 提供 CORS 配置帮助信息
     * 用于指导用户如何在 Cloudflare R2 中配置 CORS
     */
    private logCorsConfigHelp(): void {
        this.logger.info('==========================================================');
        this.logger.info('CORS 配置帮助');
        this.logger.info('==========================================================');
        this.logger.info('请在 Cloudflare R2 中为您的存储桶配置以下 CORS 策略:');
        this.logger.info(`
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3000
  }
]`);
        this.logger.info('或者，为了更安全的配置，您可以将 AllowedOrigins 设置为:');
        this.logger.info('["app://obsidian.md", "https://your-public-domain.com"]');
        this.logger.info('==========================================================');
        this.logger.info('关于 CORS 配置的更多信息，请访问:');
        this.logger.info('https://developers.cloudflare.com/r2/buckets/cors/');
        this.logger.info('==========================================================');
    }
} 