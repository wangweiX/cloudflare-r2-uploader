import {Notice} from 'obsidian';
import * as path from 'path';
import {UploadResult} from '../models/cloudflare';
import {PluginSettings} from '../models/settings';
import {StorageProvider, StorageProviderType} from '../models/storage-provider';
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
     * 上传文件到Cloudflare Worker
     */
    public async uploadFile(filePath: string, fileContent: ArrayBuffer): Promise<UploadResult> {
        try {
            const {workerUrl, apiKey, bucketName, folderName, customDomain} = this.settings.workerSettings;

            if (!workerUrl || !apiKey) {
                throw new Error('Worker URL或API Key未配置');
            }

            const fileName = path.basename(filePath);

            // 根据文件扩展名获取MIME类型
            const getMimeType = (fileName: string): string => {
                const extension = path.extname(fileName).toLowerCase().replace('.', '');
                const mimeTypes: { [key: string]: string } = {
                    'jpg': 'image/jpeg',
                    'jpeg': 'image/jpeg',
                    'png': 'image/png',
                    'gif': 'image/gif',
                    'webp': 'image/webp',
                    'pdf': 'application/pdf',
                    'txt': 'text/plain',
                    'doc': 'application/msword',
                    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'xls': 'application/vnd.ms-excel',
                    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                };
                return mimeTypes[extension] || 'application/octet-stream';
            };

            // 获取文件的MIME类型
            const mimeType = getMimeType(fileName);
            this.logger.info(`上传文件类型: ${mimeType}, 文件名: ${fileName}`);

            // 准备表单数据
            const formData = new FormData();
            const blob = new Blob([fileContent], {type: mimeType});
            formData.append('file', blob, fileName);

            // 如果有文件夹名称，添加到表单数据
            if (folderName) {
                formData.append('folder', folderName);
            }

            // 发送请求到Worker
            this.logger.info(`开始上传文件到Worker: ${fileName}`);
            const response = await fetch(workerUrl + `/api/v1/buckets/${bucketName}/files`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                body: formData
            });

            // 解析响应
            const json = await response.json();

            if (response.ok && json.success) {
                if (json.path) {
                    const fileIdentifier = json.path;
                    let imageUrl;

                    // 如果配置了自定义域名，则使用自定义域名构建URL
                    if (customDomain && customDomain.trim() !== '') {
                        // 确保自定义域名是完整的URL
                        const domainBase = customDomain.startsWith('http') ? customDomain : `https://${customDomain}`;
                        const formattedDomain = domainBase.endsWith('/') ? domainBase : `${domainBase}/`;
                        imageUrl = `${formattedDomain}${fileIdentifier.startsWith('/') ? fileIdentifier.substring(1) : fileIdentifier}`;
                    } else {
                        // 使用Worker URL作为基础URL
                        const baseUrl = new URL(workerUrl);
                        // 构造完整的图片URL
                        imageUrl = `${baseUrl.origin}/${fileIdentifier.startsWith('/') ? fileIdentifier.substring(1) : fileIdentifier}`;
                    }

                    this.logger.info(`文件上传成功: ${fileName}, URL: ${imageUrl}`);
                    return {
                        success: true,
                        localPath: filePath,
                        imageId: imageUrl
                    };
                } else {
                    this.logger.error(`上传文件成功但缺少URL信息: ${fileName}`);
                    new Notice(`上传文件成功但缺少URL信息: ${fileName}`, 3000);
                    return {
                        success: false,
                        localPath: filePath,
                        error: '上传成功但无法获取URL'
                    };
                }
            } else {
                const errorMessage = json.error || '未知错误';
                this.logger.error(`上传文件失败 ${filePath}: ${errorMessage}`);
                new Notice(`上传文件失败: ${fileName}`, 3000);
                return {
                    success: false,
                    localPath: filePath,
                    error: errorMessage
                };
            }
        } catch (error) {
            this.logger.error(`处理文件时出错 ${filePath}:`, error);
            new Notice(`处理文件出错: ${path.basename(filePath)}`, 3000);
            return {
                success: false,
                localPath: filePath,
                error: (error as Error).message
            };
        }
    }

    /**
     * 获取文件URL
     * 由于构建的imageId已经是完整URL，所以直接返回
     */
    public getFileUrl(imageId: string): string {
        return imageId; // imageId是完整URL
    }
} 