import {App, Notice, TFile} from 'obsidian';
import * as path from 'path';
import {v4 as uuidv4} from 'uuid';
import {StorageProvider} from '../models/storage-provider';
import {Logger} from '../utils/logger';

/**
 * 当前文件上传结果接口
 */
export interface CurrentFileUploadResult {
    totalImages: number;
    successCount: number;
    failureCount: number;
    newMappings: Record<string, string>;
}

/**
 * 重试配置
 */
interface RetryConfig {
    maxRetries: number;  // 最大重试次数
    delayMs: number;     // 重试间隔（毫秒）
}

/**
 * 当前文件图片上传服务 - 专门处理当前打开的文件中的图片
 */
export class CurrentFileUploader {
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
        private storageProvider: StorageProvider,
    ) {
        this.logger = Logger.getInstance();
    }

    /**
     * 生成唯一文件名
     * 使用UUID生成唯一名称，比时间戳更可靠
     */
    private generateUniqueFileName(originalPath: string): string {
        const extension = path.extname(originalPath);
        const baseName = path.basename(originalPath, extension);
        return `${baseName}-${uuidv4()}${extension}`;
    }

    /**
     * 处理当前活动文件中的图片
     * @returns 处理结果，包含图片总数、成功数、失败数和新的映射记录
     */
    public async processCurrentFile(): Promise<CurrentFileUploadResult | null> {
        // 获取当前活动的文件
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('请先打开一个 Markdown 笔记文件', 3000);
            return null;
        }

        try {
            this.logger.info(`开始处理当前笔记文件：${activeFile.path}`);
            new Notice(`开始处理笔记文件：${activeFile.basename}`, 2000);

            // 查找文件中的图片
            const imagesToUpload = await this.findImagesInFile(activeFile);

            if (imagesToUpload.size === 0) {
                this.logger.info('当前笔记中没有需要上传的图片');
                new Notice('当前笔记中没有找到需要上传的图片', 3000);
                return {
                    totalImages: 0,
                    successCount: 0,
                    failureCount: 0,
                    newMappings: {}
                };
            }

            this.logger.info(`找到 ${imagesToUpload.size} 张图片需要上传.`);
            
            // 打印所有识别到的图片地址
            this.logger.info('图片地址列表:');
            Array.from(imagesToUpload).forEach((imagePath, index) => {
                this.logger.info(`[${index + 1}] ${imagePath}`);
            });
            
            new Notice(`找到 ${imagesToUpload.size} 张图片需要上传`, 2000);

            // 上传图片
            const {newMappings, successCount, failCount} = await this.uploadImages(Array.from(imagesToUpload));

            // 更新当前笔记中的链接
            await this.updateFileLinks(activeFile, newMappings);

            this.logger.info('当前笔记图片处理完成');

            // 返回处理结果
            return {
                totalImages: imagesToUpload.size,
                successCount,
                failureCount: failCount,
                newMappings
            };
        } catch (error) {
            this.logger.error('处理当前笔记图片时出错', error);
            new Notice(`处理图片时出错: ${(error as Error).message}`, 5000);
            return null;
        }
    }

    /**
     * 在文件中查找需要上传的图片
     */
    private async findImagesInFile(file: TFile): Promise<Set<string>> {
        const imagePathsToUpload = new Set<string>();
        const content = await this.app.vault.cachedRead(file);

        // 查找所有标准格式的图片链接 ![alt](path)
        const standardRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
        let standardMatch;
        while ((standardMatch = standardRegex.exec(content)) !== null) {
            const imagePath = standardMatch[2];

            // 跳过已经是网络图片的链接和临时占位符
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || 
                imagePath.startsWith('pasted-image-')) {
                continue;
            }

            // 解析绝对路径
            const absolutePath = this.resolveAbsolutePath(file.path, imagePath);
            if (await this.fileExists(absolutePath)) {
                imagePathsToUpload.add(absolutePath);
            } else {
                this.logger.warn(`图片文件不存在：${absolutePath}`);
            }
        }

        // 查找所有 Obsidian 内部链接格式的图片 ![[path]]
        const obsidianRegex = /!\[\[([^\]]+)\]\]/g;
        let obsidianMatch;
        while ((obsidianMatch = obsidianRegex.exec(content)) !== null) {
            const imagePath = obsidianMatch[1];
            
            // 解析绝对路径
            const absolutePath = this.resolveAbsolutePath(file.path, imagePath);
            if (await this.fileExists(absolutePath)) {
                imagePathsToUpload.add(absolutePath);
            } else {
                this.logger.warn(`图片文件不存在：${absolutePath}`);
            }
        }

        return imagePathsToUpload;
    }

    /**
     * 检查文件是否存在
     */
    private async fileExists(path: string): Promise<boolean> {
        try {
            return await this.app.vault.adapter.exists(path);
        } catch (error) {
            this.logger.error(`检查文件是否存在时出错: ${path}`, error);
            return false;
        }
    }

    /**
     * 解析图片绝对路径
     */
    private resolveAbsolutePath(notePath: string, imagePath: string): string {
        if (imagePath.startsWith('/')) {
            return imagePath.substring(1);
        } else {
            const noteDir = path.dirname(notePath);
            return path.join(noteDir, imagePath);
        }
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
            // const uniqueFileName = this.generateUniqueFileName(imagePath);

            // 上传图片
            const result = await this.storageProvider.uploadFile(imagePath, fileContent);

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
     * 上传图片到存储服务
     */
    private async uploadImages(paths: string[]): Promise<{
        newMappings: Record<string, string>,
        successCount: number,
        failCount: number
    }> {
        if (paths.length === 0) {
            return {newMappings: {}, successCount: 0, failCount: 0};
        }

        const newMappings: Record<string, string> = {};
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
                    newMappings[imagePath] = result.imageUrl;
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

        return {newMappings, successCount, failCount};
    }

    /**
     * 更新当前文件中的图片链接
     */
    private async updateFileLinks(file: TFile, uploadResults: Record<string, string>): Promise<void> {
        const content = await this.app.vault.cachedRead(file);
        let modified = false;
        let newContent = content;

        // 处理标准格式的图片链接 ![alt](path)
        const standardRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
        let standardMatch;
        let lastIndex = 0;
        let standardNewContent = '';

        while ((standardMatch = standardRegex.exec(content)) !== null) {
            const fullMatch = standardMatch[0];
            const altText = standardMatch[1];
            const imagePath = standardMatch[2];

            // 跳过网络图片和临时占位符
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://') ||
                imagePath.startsWith('pasted-image-')) {
                continue;
            }

            const absolutePath = this.resolveAbsolutePath(file.path, imagePath);
            const newImageUrl = uploadResults[absolutePath];

            if (newImageUrl) {
                // 添加匹配前的内容
                standardNewContent += content.substring(lastIndex, standardMatch.index);
                // 添加替换后的图片标记
                standardNewContent += `![${altText}](${newImageUrl})`;

                lastIndex = standardMatch.index + fullMatch.length;
                modified = true;
            }
        }

        if (modified) {
            // 添加剩余内容
            standardNewContent += content.substring(lastIndex);
            newContent = standardNewContent;
        }

        // 处理 Obsidian 内部链接格式的图片 ![[path]]
        modified = false;
        const obsidianRegex = /!\[\[([^\]]+)\]\]/g;
        let obsidianMatch;
        lastIndex = 0;
        let obsidianNewContent = '';

        while ((obsidianMatch = obsidianRegex.exec(newContent)) !== null) {
            const fullMatch = obsidianMatch[0];
            const imagePath = obsidianMatch[1];
            
            const absolutePath = this.resolveAbsolutePath(file.path, imagePath);
            const newImageUrl = uploadResults[absolutePath];

            if (newImageUrl) {
                // 添加匹配前的内容
                obsidianNewContent += newContent.substring(lastIndex, obsidianMatch.index);
                // 添加替换后的图片标记（转换为标准 Markdown 格式）
                obsidianNewContent += `![${path.basename(imagePath, path.extname(imagePath))}](${newImageUrl})`;

                lastIndex = obsidianMatch.index + fullMatch.length;
                modified = true;
            }
        }

        if (modified) {
            // 添加剩余内容
            obsidianNewContent += newContent.substring(lastIndex);
            newContent = obsidianNewContent;
        }

        // 只有当内容被修改时才写入文件
        if (newContent !== content) {
            // 写入文件
            await this.app.vault.modify(file, newContent);
        }
    }
} 