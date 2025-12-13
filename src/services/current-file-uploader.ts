import {App, Notice, TFile} from 'obsidian';
import * as path from 'path';
import {StorageProvider, UploadTask} from '../types';
import {UploadManager} from './upload-manager';
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
 * 当前文件图片上传服务 - 专门处理当前打开的文件中的图片
 * 使用新的上传管理器处理并发和状态管理
 */
export class CurrentFileUploader {
    private logger: Logger;
    private isProcessing: boolean = false;
    private lastProcessTime: number = 0;
    private debounceDelay: number = 1000; // 防抖延迟1秒
    private settings: any; // 添加设置引用

    /**
     * 构造函数
     */
    constructor(
        private app: App,
        private storageProvider: StorageProvider,
        private uploadManager: UploadManager,
        settings?: any
    ) {
        this.logger = Logger.getInstance();
        this.settings = settings;
    }

    /**
     * 处理当前活动文件中的图片（带防抖）
     */
    public async processCurrentFile(): Promise<CurrentFileUploadResult | null> {
        // 防抖处理，防止用户快速点击
        const now = Date.now();
        if (now - this.lastProcessTime < this.debounceDelay) {
            this.logger.info('操作过于频繁，请稍后再试');
            new Notice('操作过于频繁，请稍后再试', 2000);
            return null;
        }
        this.lastProcessTime = now;

        // 检查是否正在处理
        if (this.isProcessing) {
            this.logger.info('正在处理中，请等待当前操作完成');
            new Notice('正在处理中，请等待当前操作完成', 2000);
            return null;
        }

        // 获取当前活动的文件
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('请先打开一个 Markdown 笔记文件', 3000);
            return null;
        }

        try {
            this.isProcessing = true;
            this.logger.info(`开始处理当前笔记文件：${activeFile.path}`);

            // 创建进度通知
            const progressNotice = new Notice('正在分析图片...', 0);

            // 查找文件中的图片
            const imagesToUpload = await this.findImagesInFile(activeFile);

            if (imagesToUpload.size === 0) {
                progressNotice.hide();
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
            progressNotice.setMessage(`找到 ${imagesToUpload.size} 张图片，正在准备上传...`);

            // 使用上传管理器添加任务
            const imagePaths = Array.from(imagesToUpload);
            const tasks = await this.uploadManager.addTasks(imagePaths);

            // 监听上传进度
            const taskResults = new Map<string, UploadTask>();
            let completedCount = 0;

            // 定义事件处理函数
            const handleTaskComplete = (task: UploadTask) => {
                if (tasks.some(t => t.id === task.id)) {
                    taskResults.set(task.filePath, task);
                    completedCount++;

                    // 更新进度
                    const progress = Math.round((completedCount / tasks.length) * 100);
                    progressNotice.setMessage(`上传进度: ${progress}% (${completedCount}/${tasks.length})`);
                }
            };

            const handleTaskFailed = (task: UploadTask) => {
                if (tasks.some(t => t.id === task.id)) {
                    taskResults.set(task.filePath, task);
                    completedCount++;

                    // 更新进度
                    const progress = Math.round((completedCount / tasks.length) * 100);
                    progressNotice.setMessage(`上传进度: ${progress}% (${completedCount}/${tasks.length})`);
                }
            };

            const handleTaskCancelled = (task: UploadTask) => {
                if (tasks.some(t => t.id === task.id)) {
                    taskResults.set(task.filePath, task);
                    completedCount++;
                }
            };

            // 添加事件监听器
            this.uploadManager.on(UploadManager.EVENTS.TASK_COMPLETED, handleTaskComplete);
            this.uploadManager.on(UploadManager.EVENTS.TASK_FAILED, handleTaskFailed);
            this.uploadManager.on(UploadManager.EVENTS.TASK_CANCELLED, handleTaskCancelled);

            // 创建Promise来等待所有任务完成
            const completionPromise = new Promise<void>((resolve) => {
                const checkCompletion = setInterval(() => {
                    if (completedCount >= tasks.length) {
                        clearInterval(checkCompletion);
                        resolve();
                    }
                }, 100);
            });

            try {
                // 等待所有任务完成
                await completionPromise;
                progressNotice.hide();
            } finally {
                // 清理事件监听器
                this.uploadManager.off(UploadManager.EVENTS.TASK_COMPLETED, handleTaskComplete);
                this.uploadManager.off(UploadManager.EVENTS.TASK_FAILED, handleTaskFailed);
                this.uploadManager.off(UploadManager.EVENTS.TASK_CANCELLED, handleTaskCancelled);
            }

            // 统计结果
            let successCount = 0;
            let failureCount = 0;
            const newMappings: Record<string, string> = {};

            for (const [filePath, task] of taskResults) {
                if (task.status === 'completed' && task.url) {
                    successCount++;
                    newMappings[filePath] = task.url;
                } else {
                    failureCount++;
                }
            }

            // 更新当前笔记中的链接
            if (Object.keys(newMappings).length > 0) {
                this.logger.info(`准备更新链接，映射关系:`, newMappings);
                await this.updateFileLinks(activeFile, newMappings);

                // 链接更新成功后，如果启用了删除选项，删除本地文件
                if (this.settings?.deleteAfterUpload) {
                    for (const [filePath, url] of Object.entries(newMappings)) {
                        try {
                            await this.app.vault.adapter.remove(filePath);
                            this.logger.info(`已删除本地文件: ${filePath}`);
                        } catch (deleteError) {
                            this.logger.warn(`删除本地文件失败: ${filePath}`, deleteError);
                        }
                    }
                }
            }

            this.logger.info('当前笔记图片处理完成');

            // 返回处理结果
            return {
                totalImages: imagesToUpload.size,
                successCount,
                failureCount,
                newMappings
            };
        } catch (error) {
            this.logger.error('处理当前笔记图片时出错', error);
            new Notice(`处理图片时出错: ${(error as Error).message}`, 5000);
            return null;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * 在文件中查找需要上传的图片
     */
    private async findImagesInFile(file: TFile): Promise<Set<string>> {
        const imagePathsToUpload = new Set<string>();
        const tmpImgPaths = new Set<string>();
        const content = await this.app.vault.cachedRead(file);

        // 查找所有标准格式的图片链接 ![alt](path)
        const standardRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
        let standardMatch;
        while ((standardMatch = standardRegex.exec(content)) !== null) {
            const imagePath = standardMatch[2];

            // 跳过已经是网络图片的链接和临时占位符
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                continue;
            }
            tmpImgPaths.add(imagePath);
        }

        // 查找所有 Obsidian 内部链接格式的图片 ![[path]]
        const obsidianRegex = /!\[\[([^\]]+)\]\]/g;
        let obsidianMatch;
        while ((obsidianMatch = obsidianRegex.exec(content)) !== null) {
            const imagePath = obsidianMatch[1];
            tmpImgPaths.add(imagePath);
        }

        // 处理每个找到的图片路径
        for (const imagePath of tmpImgPaths) {
            let absolutePath = await this.resolveAbsolutePath(file.path, imagePath);
            if (absolutePath === '') {
                this.logger.warn(`无法解析图片路径: ${imagePath}`);
                continue;
            }

            // 检查文件是否存在
            const exists = await this.app.vault.adapter.exists(absolutePath);
            if (!exists) {
                this.logger.warn(`图片文件不存在: ${absolutePath}`);
                continue;
            }

            // 检查文件大小
            const stat = await this.app.vault.adapter.stat(absolutePath);
            if (stat && stat.size) {
                imagePathsToUpload.add(absolutePath);
                this.logger.info(`找到图片：${absolutePath} (${this.formatFileSize(stat.size)})`);
            }
        }

        return imagePathsToUpload;
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
            if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                continue;
            }

            const absolutePath = await this.resolveAbsolutePath(file.path, imagePath);
            if (absolutePath === '') {
                this.logger.warn(`无法解析图片路径: ${imagePath}`);
                continue;
            }
            const newImageUrl = uploadResults[absolutePath];
            this.logger.info(`查找标准格式映射: ${imagePath} -> ${absolutePath} -> ${newImageUrl || '未找到'}`);

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

            const absolutePath = await this.resolveAbsolutePath(file.path, imagePath);
            if (absolutePath === '') {
                this.logger.warn(`无法解析图片路径: ${imagePath}`);
                continue;
            }
            const newImageUrl = uploadResults[absolutePath];
            this.logger.info(`查找Obsidian格式映射: ${imagePath} -> ${absolutePath} -> ${newImageUrl || '未找到'}`);

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
            this.logger.info(`已更新文件中的图片链接: ${file.path}`);
            this.logger.info(`更新的链接数量: ${Object.keys(uploadResults).length}`);
        } else {
            this.logger.warn(`文件内容未发生变化，可能链接替换失败: ${file.path}`);
        }
    }

    /**
     * 将图片的相对路径解析为绝对路径
     */
    private async resolveAbsolutePath(filePath: string, imagePath: string): Promise<string> {
        // 如果图片路径已经是绝对路径，直接返回
        if (path.isAbsolute(imagePath)) {
            return imagePath;
        }

        // 获取当前文件所在的目录
        let fileDir = path.dirname(filePath);
        let absolutePath = path.normalize(path.join(fileDir, imagePath));

        // 尝试从当前文件所在的目录下查找
        let exists = await this.app.vault.adapter.exists(absolutePath);
        if (exists) {
            return absolutePath;
        }

        // 尝试从 vault 根目录下查找
        absolutePath = path.normalize(imagePath);
        exists = await this.app.vault.adapter.exists(absolutePath);
        if (exists) {
            return absolutePath;
        }

        return '';
    }

    /**
     * 格式化文件大小
     */
    private formatFileSize(bytes: number): string {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    /**
     * 取消所有上传任务
     */
    public cancelAll(): void {
        this.uploadManager.cancelAll();
        this.isProcessing = false;
    }
}
