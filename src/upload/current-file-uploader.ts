import {App, Notice, TFile} from 'obsidian';
import {PluginSettings, UploadTask} from '../types';
import {UploadManager} from './upload-manager';
import {ImageFinder, LinkUpdater} from '../image';
import {Logger, formatFileSize} from '../utils';

/**
 * Result of current file upload operation
 */
export interface CurrentFileUploadResult {
    totalImages: number;
    successCount: number;
    failureCount: number;
    newMappings: Record<string, string>;
}

/**
 * CurrentFileUploader - Orchestrates image upload for the current file
 *
 * Responsibilities:
 * - Coordinate between ImageFinder, UploadManager, and LinkUpdater
 * - Handle UI notifications and progress updates
 * - Manage debouncing and processing state
 *
 * This is now a thin orchestrator that delegates to specialized modules.
 */
export class CurrentFileUploader {
    private readonly logger: Logger;
    private readonly finder: ImageFinder;
    private readonly updater: LinkUpdater;

    private isProcessing = false;
    private lastProcessTime = 0;
    private readonly debounceDelay = 1000;

    constructor(
        private readonly app: App,
        private readonly uploadManager: UploadManager,
        private readonly settings?: PluginSettings
    ) {
        this.logger = Logger.getInstance();
        this.finder = new ImageFinder(app, app.vault.adapter);
        this.updater = new LinkUpdater(app.vault.adapter);
    }

    /**
     * Process images in the current active file
     */
    public async processCurrentFile(): Promise<CurrentFileUploadResult | null> {
        // Debounce check
        if (!this.checkDebounce()) {
            return null;
        }

        // Check processing state
        if (this.isProcessing) {
            this.logger.info('正在处理中，请等待当前操作完成');
            new Notice('正在处理中，请等待当前操作完成', 2000);
            return null;
        }

        // Get active markdown file
        const activeFile = this.getActiveMarkdownFile();
        if (!activeFile) {
            return null;
        }

        try {
            this.isProcessing = true;
            this.logger.info(`开始处理当前笔记文件：${activeFile.path}`);

            const progressNotice = new Notice('正在分析图片...', 0);

            // Step 1: Find images using ImageFinder
            const images = await this.finder.findInFile(activeFile);
            const imagePaths = images
                .filter(img => img.exists)
                .map(img => img.absolutePath);

            if (imagePaths.length === 0) {
                progressNotice.hide();
                this.logger.info('当前笔记中没有需要上传的图片');
                new Notice('当前笔记中没有找到需要上传的图片', 3000);
                return this.createEmptyResult();
            }

            this.logFoundImages(images);
            progressNotice.setMessage(`找到 ${imagePaths.length} 张图片，正在准备上传...`);

            // Step 2: Add tasks to UploadManager
            const tasks = await this.uploadManager.addTasks(imagePaths);

            // Step 3: Wait for all tasks to complete
            const taskResults = await this.waitForTasks(tasks, progressNotice);
            progressNotice.hide();

            // Step 4: Build result and mappings
            const result = this.buildResult(taskResults);

            // Step 5: Update links using LinkUpdater
            if (Object.keys(result.newMappings).length > 0) {
                await this.updateFileAndCleanup(activeFile, result.newMappings);
            }

            this.logger.info('当前笔记图片处理完成');
            return result;

        } catch (error) {
            this.logger.error('处理当前笔记图片时出错', error);
            new Notice(`处理图片时出错: ${(error as Error).message}`, 5000);
            return null;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Cancel all upload tasks
     */
    public cancelAll(): void {
        this.uploadManager.cancelAll();
        this.isProcessing = false;
    }

    // ===== Private Helper Methods =====

    private checkDebounce(): boolean {
        const now = Date.now();
        if (now - this.lastProcessTime < this.debounceDelay) {
            this.logger.info('操作过于频繁，请稍后再试');
            new Notice('操作过于频繁，请稍后再试', 2000);
            return false;
        }
        this.lastProcessTime = now;
        return true;
    }

    private getActiveMarkdownFile(): TFile | null {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || activeFile.extension !== 'md') {
            new Notice('请先打开一个 Markdown 笔记文件', 3000);
            return null;
        }
        return activeFile;
    }

    private logFoundImages(images: Array<{absolutePath: string; size?: number}>): void {
        for (const img of images) {
            if (img.size) {
                this.logger.info(`找到图片：${img.absolutePath} (${formatFileSize(img.size)})`);
            }
        }
        this.logger.info(`找到 ${images.length} 张图片需要上传.`);
    }

    private createEmptyResult(): CurrentFileUploadResult {
        return {
            totalImages: 0,
            successCount: 0,
            failureCount: 0,
            newMappings: {}
        };
    }

    private async waitForTasks(
        tasks: UploadTask[],
        progressNotice: Notice
    ): Promise<Map<string, UploadTask>> {
        const taskResults = new Map<string, UploadTask>();
        let completedCount = 0;

        const handleTaskComplete = (task: UploadTask) => {
            if (tasks.some(t => t.id === task.id)) {
                taskResults.set(task.filePath, task);
                completedCount++;
                this.updateProgress(progressNotice, completedCount, tasks.length);
            }
        };

        const handleTaskFailed = (task: UploadTask) => {
            if (tasks.some(t => t.id === task.id)) {
                taskResults.set(task.filePath, task);
                completedCount++;
                this.updateProgress(progressNotice, completedCount, tasks.length);
            }
        };

        const handleTaskCancelled = (task: UploadTask) => {
            if (tasks.some(t => t.id === task.id)) {
                taskResults.set(task.filePath, task);
                completedCount++;
            }
        };

        // Add listeners
        this.uploadManager.on(UploadManager.EVENTS.TASK_COMPLETED, handleTaskComplete);
        this.uploadManager.on(UploadManager.EVENTS.TASK_FAILED, handleTaskFailed);
        this.uploadManager.on(UploadManager.EVENTS.TASK_CANCELLED, handleTaskCancelled);

        try {
            // Wait for completion
            await new Promise<void>((resolve) => {
                const checkCompletion = setInterval(() => {
                    if (completedCount >= tasks.length) {
                        clearInterval(checkCompletion);
                        resolve();
                    }
                }, 100);
            });
        } finally {
            // Cleanup listeners
            this.uploadManager.off(UploadManager.EVENTS.TASK_COMPLETED, handleTaskComplete);
            this.uploadManager.off(UploadManager.EVENTS.TASK_FAILED, handleTaskFailed);
            this.uploadManager.off(UploadManager.EVENTS.TASK_CANCELLED, handleTaskCancelled);
        }

        return taskResults;
    }

    private updateProgress(notice: Notice, completed: number, total: number): void {
        const progress = Math.round((completed / total) * 100);
        notice.setMessage(`上传进度: ${progress}% (${completed}/${total})`);
    }

    private buildResult(taskResults: Map<string, UploadTask>): CurrentFileUploadResult {
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

        return {
            totalImages: taskResults.size,
            successCount,
            failureCount,
            newMappings
        };
    }

    private async updateFileAndCleanup(
        file: TFile,
        newMappings: Record<string, string>
    ): Promise<void> {
        this.logger.info(`准备更新链接，映射关系:`, newMappings);

        // Read current content and update links
        const content = await this.app.vault.cachedRead(file);
        const result = await this.updater.updateLinks(content, file.path, newMappings);

        if (result.modified) {
            await this.app.vault.modify(file, result.content);
            this.logger.info(`已更新文件中的图片链接: ${file.path}`);
            this.logger.info(`更新的链接数量: ${result.replacedCount}`);

            // Delete local files if enabled
            if (this.settings?.deleteAfterUpload) {
                await this.deleteUploadedFiles(newMappings);
            }
        } else {
            this.logger.warn(`文件内容未发生变化，可能链接替换失败: ${file.path}`);
        }
    }

    private async deleteUploadedFiles(mappings: Record<string, string>): Promise<void> {
        for (const filePath of Object.keys(mappings)) {
            try {
                await this.app.vault.adapter.remove(filePath);
                this.logger.info(`已删除本地文件: ${filePath}`);
            } catch (error) {
                this.logger.warn(`删除本地文件失败: ${filePath}`, error);
            }
        }
    }
}
