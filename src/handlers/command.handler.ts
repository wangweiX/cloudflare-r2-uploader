/**
 * CommandHandler - Manages plugin commands
 *
 * Responsibilities:
 * - Register commands with Obsidian
 * - Execute command callbacks
 * - Validate settings before operations
 */

import {Plugin} from 'obsidian';
import {isR2S3Provider, isWorkerProvider, PluginSettings, R2S3ProviderSettings, WorkerProviderSettings} from '../types';
import {CurrentFileUploader, UploadManager} from '../upload';
import {ImageFinder} from '../image';
import {Logger} from '../utils';

/**
 * Command definitions
 */
export interface CommandDefinition {
    id: string;
    name: string;
    callback: () => void | Promise<void>;
}

/**
 * Dependencies required by CommandHandler
 */
export interface CommandHandlerDeps {
    plugin: Plugin;
    getSettings: () => PluginSettings;
    getUploadManager: () => UploadManager;
    getCurrentFileUploader: () => CurrentFileUploader;
    getImageFinder: () => ImageFinder;
}

export class CommandHandler {
    private readonly logger: Logger;

    constructor(private readonly deps: CommandHandlerDeps) {
        this.logger = Logger.getInstance();
    }

    /**
     * Register all plugin commands
     */
    public registerCommands(): void {
        const commands = this.getCommandDefinitions();

        for (const cmd of commands) {
            this.deps.plugin.addCommand({
                id: cmd.id,
                name: cmd.name,
                callback: cmd.callback
            });
        }

        this.logger.info(`已注册 ${commands.length} 个命令`);
    }

    /**
     * Get all command definitions
     */
    private getCommandDefinitions(): CommandDefinition[] {
        return [
            {
                id: 'upload-images-to-cloudflare',
                name: '上传所有笔记中的图片',
                callback: () => this.uploadAllImages()
            },
            {
                id: 'upload-current-note-images',
                name: '上传当前笔记中的图片',
                callback: () => this.uploadCurrentNoteImages()
            },
            {
                id: 'cancel-all-uploads',
                name: '取消所有上传任务',
                callback: () => this.cancelAllUploads()
            },
            {
                id: 'retry-failed-uploads',
                name: '重试失败的上传任务',
                callback: () => this.retryFailedUploads()
            }
        ];
    }

    // ===== Command Callbacks =====

    /**
     * Upload all images in vault
     */
    private async uploadAllImages(): Promise<void> {
        this.logger.info('开始执行上传过程');

        if (!this.validateSettings()) {
            return;
        }

        try {
            const finder = this.deps.getImageFinder();
            const imagePaths = await finder.findInVault();

            this.logger.info(`找到 ${imagePaths.size} 张图片需要上传`);

            if (imagePaths.size === 0) {
                this.logger.notify('没有新的图片需要上传', 3000);
                return;
            }

            const uploadManager = this.deps.getUploadManager();
            await uploadManager.addTasks(Array.from(imagePaths));

            this.logger.notify(`已添加 ${imagePaths.size} 张图片到上传队列`, 3000);
        } catch (error) {
            this.logger.error('执行上传过程时出错', error);
            this.logger.notify('上传过程中出现错误，请查看控制台日志。', 5000);
        }
    }

    /**
     * Upload images in current note
     * Public to allow Ribbon icon to use the same validation path
     */
    public async uploadCurrentNoteImages(): Promise<void> {
        this.logger.info('开始上传当前笔记中的图片');

        if (!this.validateSettings()) {
            return;
        }

        try {
            const uploader = this.deps.getCurrentFileUploader();
            const result = await uploader.processCurrentFile();

            if (result) {
                if (result.totalImages > 0) {
                    this.logger.notify(
                        `处理完成: 成功上传 ${result.successCount} 张图片, 失败 ${result.failureCount} 张`,
                        3000
                    );
                } else {
                    this.logger.notify('当前笔记中没有需要上传的图片', 3000);
                }
            }
        } catch (error) {
            this.logger.error('上传当前笔记图片时出错', error);
            this.logger.notify('上传过程中出现错误，请查看控制台日志。', 5000);
        }
    }

    /**
     * Cancel all upload tasks
     */
    private cancelAllUploads(): void {
        const uploadManager = this.deps.getUploadManager();
        uploadManager.cancelAll();
        this.logger.notify('已取消所有上传任务', 3000);
    }

    /**
     * Retry failed upload tasks
     */
    private retryFailedUploads(): void {
        const uploadManager = this.deps.getUploadManager();
        uploadManager.retryFailed();
        this.logger.notify('已重新加入失败的任务到队列', 3000);
    }

    // ===== Settings Validation =====

    /**
     * Validate settings before upload operations.
     * Uses type guards for type-safe provider-specific validation.
     */
    private validateSettings(): boolean {
        const settings = this.deps.getSettings();

        // Use type guards for type-safe validation
        if (isR2S3Provider(settings)) {
            return this.validateR2S3Settings(settings);
        }

        if (isWorkerProvider(settings)) {
            return this.validateWorkerSettings(settings);
        }

        // Should never reach here with proper discriminated union
        this.logger.notify('未知的存储提供者类型', 5000);
        return false;
    }

    /**
     * Validate R2 S3 API settings.
     * Type guard ensures settings.r2S3Settings is defined.
     */
    private validateR2S3Settings(settings: R2S3ProviderSettings): boolean {
        // TypeScript knows r2S3Settings is defined due to type guard
        const {accountId, accessKeyId, secretAccessKey, bucketName} = settings.r2S3Settings;
        if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
            this.logger.notify('请先在插件设置中完成 R2 S3 API 的配置。', 5000);
            return false;
        }

        return true;
    }

    /**
     * Validate Cloudflare Worker settings.
     */
    private validateWorkerSettings(settings: WorkerProviderSettings): boolean {
        const {workerUrl, apiKey} = settings.workerSettings;
        if (!workerUrl || !apiKey) {
            this.logger.notify('请先在插件设置中完成 Cloudflare Worker 的配置。', 5000);
            return false;
        }

        return true;
    }
}
