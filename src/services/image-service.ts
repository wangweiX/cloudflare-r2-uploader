import {App, Notice} from 'obsidian';
import * as path from 'path';
import {v4 as uuidv4} from 'uuid';
import {StorageProvider} from '../models/storage-provider';
import {Logger} from '../utils/logger';

/**
 * 重试配置
 */
interface RetryConfig {
    maxRetries: number;  // 最大重试次数
    delayMs: number;     // 重试间隔（毫秒）
}

/**
 * 图片服务 - 负责处理图片的解析、上传和替换
 * 使用工厂模式创建图片处理工具
 */
export class ImageService {
    private logger: Logger;
    private retryConfig: RetryConfig = {
        maxRetries: 3,
        delayMs: 1000
    };

    /**
     * 构造函数
     */
    constructor(
        private app: App,
        private storageProvider: StorageProvider
    ) {
        this.logger = Logger.getInstance();
    }

    /**
     * 解析图片路径
     */
    public resolveAbsolutePath(notePath: string, imagePath: string): string {
        if (imagePath.startsWith('/')) {
            return imagePath.substring(1);
        } else {
            const noteDir = path.dirname(notePath);
            return path.join(noteDir, imagePath);
        }
    }

    /**
     * 生成唯一文件名
     * 使用UUID生成唯一名称
     */
    private generateUniqueFileName(originalPath: string): string {
        const extension = path.extname(originalPath);
        const baseName = path.basename(originalPath, extension);
        return `${baseName}-${uuidv4()}${extension}`;
    }

    /**
     * 延迟函数 - 用于重试间隔
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * 带重试机制的上传单个图片
     */
    private async uploadImageWithRetry(
        imagePath: string,
        fileContent: ArrayBuffer,
        retryCount = 0
    ): Promise<{ success: boolean; imageUrl?: string }> {
        try {
            // 生成唯一文件名
            const uniqueFileName = this.generateUniqueFileName(imagePath);

            // 上传图片
            const result = await this.storageProvider.uploadFile(uniqueFileName, fileContent);

            if (result.success && result.imageId) {
                const imageUrl = this.storageProvider.getFileUrl(result.imageId);
                return {success: true, imageUrl};
            } else {
                // 达到最大重试次数
                if (retryCount >= this.retryConfig.maxRetries) {
                    this.logger.warn(`图片上传失败，已达到最大重试次数: ${imagePath}`);
                    return {success: false};
                }

                // 准备重试
                this.logger.info(`图片上传失败，将进行第 ${retryCount + 1} 次重试: ${imagePath}`);
                await this.delay(this.retryConfig.delayMs);
                return this.uploadImageWithRetry(imagePath, fileContent, retryCount + 1);
            }
        } catch (error) {
            // 达到最大重试次数
            if (retryCount >= this.retryConfig.maxRetries) {
                this.logger.error(`图片上传出错，已达到最大重试次数: ${imagePath}`, error);
                return {success: false};
            }

            // 准备重试
            this.logger.info(`图片上传出错，将进行第 ${retryCount + 1} 次重试: ${imagePath}`);
            await this.delay(this.retryConfig.delayMs);
            return this.uploadImageWithRetry(imagePath, fileContent, retryCount + 1);
        }
    }

    /**
     * 查找笔记中的图片
     */
    public async findImagesToUpload(): Promise<Set<string>> {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const imagePathsToUpload = new Set<string>();

        for (const file of markdownFiles) {
            const content = await this.app.vault.cachedRead(file);
            const regex = /!\[([^\]]*)\]\(([^)]*)\)/g;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const imagePath = match[2];
                if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                    continue;
                }
                const absolutePath = this.resolveAbsolutePath(file.path, imagePath);
                if (await this.app.vault.adapter.exists(absolutePath)) {
                    imagePathsToUpload.add(absolutePath);
                } else {
                    this.logger.warn(`图片文件不存在：${absolutePath}`);
                }
            }
        }

        return imagePathsToUpload;
    }

    /**
     * 上传图片到存储服务
     */
    public async uploadImages(paths: string[]): Promise<Record<string, string>> {
        if (paths.length === 0) {
            return {};
        }

        const uploadResults: Record<string, string> = {};
        let successCount = 0;
        let failCount = 0;
        let currentIndex = 0;
        const totalImages = paths.length;

        // 创建和更新进度通知的函数
        const updateProgress = () => {
            const percentage = Math.round((currentIndex / totalImages) * 100);
            new Notice(`上传进度: ${percentage}% (${currentIndex}/${totalImages})`, 1000);
        };

        // 显示初始进度
        updateProgress();

        for (const imagePath of paths) {
            try {
                // 更新进度计数
                currentIndex++;

                // 获取文件内容
                const fileContent = await this.app.vault.adapter.readBinary(imagePath);

                // 带重试的上传图片
                const result = await this.uploadImageWithRetry(imagePath, fileContent);

                if (result.success && result.imageUrl) {
                    uploadResults[imagePath] = result.imageUrl;
                    successCount++;
                } else {
                    failCount++;
                }

                // 更新进度（每处理完一张图片或特定比例时更新）
                if (currentIndex % Math.max(1, Math.floor(totalImages / 10)) === 0 || currentIndex === totalImages) {
                    updateProgress();
                }
            } catch (error) {
                this.logger.error(`处理图片时出错 ${imagePath}:`, error);
                new Notice(`处理图片出错: ${path.basename(imagePath)}`, 3000);
                failCount++;
                currentIndex++;
            }
        }

        // 显示汇总通知
        if (successCount > 0) {
            new Notice(`成功上传 ${successCount} 张图片`, 3000);
        }
        if (failCount > 0) {
            new Notice(`有 ${failCount} 张图片上传失败`, 3000);
        }

        return uploadResults;
    }

    /**
     * 更新笔记中的图片链接
     */
    public async updateNotes(uploadResults: Record<string, string>): Promise<void> {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        let updatedCount = 0;

        for (const file of markdownFiles) {
            let content = await this.app.vault.cachedRead(file);
            let modified = false;

            const regex = /!\[([^\]]*)\]\(([^)]*)\)/g;
            let match;
            let lastIndex = 0;
            let newContent = '';

            while ((match = regex.exec(content)) !== null) {
                const fullMatch = match[0];
                const altText = match[1];
                const imagePath = match[2];

                if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                    continue;
                }

                const absolutePath = this.resolveAbsolutePath(file.path, imagePath);
                if (uploadResults[absolutePath]) {
                    const newImageUrl = uploadResults[absolutePath];

                    // 添加匹配前的内容
                    newContent += content.substring(lastIndex, match.index);
                    // 添加替换后的图片标记
                    newContent += `![${altText}](${newImageUrl})`;

                    lastIndex = match.index + fullMatch.length;
                    modified = true;
                }
            }

            if (modified) {
                // 添加剩余内容
                newContent += content.substring(lastIndex);
                // 写入文件
                await this.app.vault.modify(file, newContent);
                updatedCount++;
            }
        }

        if (updatedCount > 0) {
            new Notice(`已更新 ${updatedCount} 个笔记文件`, 3000);
        }
    }
} 