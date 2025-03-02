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
            const {workerUrl, apiKey, folderName} = this.settings.workerSettings;

            if (!workerUrl || !apiKey) {
                throw new Error('Worker URL或API Key未配置');
            }

            const fileName = path.basename(filePath);

            // 准备表单数据
            const formData = new FormData();
            const blob = new Blob([fileContent], {type: 'application/octet-stream'});
            formData.append('file', blob, fileName);

            // 如果有文件夹名称，添加到表单数据
            if (folderName) {
                formData.append('folder', folderName);
            }

            // 发送请求到Worker
            this.logger.info(`开始上传文件到Worker: ${fileName}`);
            const response = await fetch(workerUrl, {
                method: 'POST',
                headers: {
                    'Authorization': apiKey
                },
                body: formData
            });

            // 解析响应
            const json = await response.json();

            if (response.ok && json.success && json.url) {
                this.logger.info(`文件上传成功: ${fileName}, URL: ${json.url}`);
                return {
                    success: true,
                    localPath: filePath,
                    imageId: json.url // 直接使用返回的URL作为imageId
                };
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
     * 由于Worker上传返回的是完整URL，所以直接返回imageId
     */
    public getFileUrl(imageId: string): string {
        return imageId; // Worker服务返回的imageId就是完整URL
    }
} 