import {addIcon, Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, UPLOAD_ICON} from '../config';
import {PluginSettings, StorageProvider, StorageProviderType} from '../types';
import {CloudflareWorkerService, R2S3Service} from '../providers';
import {ImageService} from '../services/image-service';
import {PasteHandler} from '../services/paste-handler';
import {CurrentFileUploader} from '../services/current-file-uploader';
import {UploadManager} from '../upload';
import {SettingsTab} from '../ui/settings-tab';
import {Logger} from '../utils';

/**
 * 插件主类
 */
export class CloudflareImagesUploader extends Plugin {
    public settings: PluginSettings = DEFAULT_SETTINGS;
    private storageProvider!: StorageProvider;
    private imageService!: ImageService;
    private pasteHandler!: PasteHandler;
    private currentFileUploader!: CurrentFileUploader;
    private uploadManager!: UploadManager;
    private logger!: Logger;

    /**
     * 插件加载
     */
    async onload() {
        // 初始化日志
        this.logger = Logger.getInstance();
        this.logger.info('加载 Cloudflare Images Uploader 插件');

        // 初始化设置
        await this.loadSettings();

        // 应用日志配置
        this.logger.setShowDetailedLogs(this.settings.showDetailedLogs || false);
        this.logger.setShowProgressNotifications(this.settings.showProgressNotifications ?? true);

        // 初始化服务
        this.initializeServices();

        // 添加设置选项卡
        this.addSettingTab(new SettingsTab(this.app, this));

        // 注册图标
        addIcon('upload-images', UPLOAD_ICON);

        // 添加命令
        this.registerCommands();

        // 添加Ribbon图标
        this.addRibbonIcon('upload-images', '上传当前笔记中的图片', () => {
            this.uploadCurrentNoteImages();
        });

        // 根据设置决定是否启用自动粘贴上传功能
        if (this.settings.enableAutoPaste) {
            this.pasteHandler.registerPasteEvent();
            this.logger.info('已启用自动粘贴上传功能');
        }
    }

    /**
     * 插件卸载
     */
    async onunload() {
        this.logger.info('卸载 Cloudflare Images Uploader 插件');

        // 取消所有上传任务
        if (this.uploadManager) {
            this.uploadManager.cancelAll();
        }

        // 取消注册事件
        if (this.pasteHandler) {
            this.pasteHandler.unregisterPasteEvent();
        }

        // 销毁上传管理器实例
        UploadManager.destroyInstance();
    }

    /**
     * 加载设置
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * 保存设置
     */
    async saveSettings() {
        await this.saveData(this.settings);
        // 直接调用设置变更处理
        this.handleSettingsChange();
    }

    /**
     * 初始化服务
     */
    private initializeServices(): void {
        // 创建存储提供者
        this.storageProvider = this.createStorageProvider();

        // 创建上传管理器（单例）
        this.uploadManager = UploadManager.getInstance(
            this.app,
            this.storageProvider,
            {
                maxConcurrency: this.settings.maxConcurrentUploads || 3,
                maxRetries: this.settings.maxRetries || 3,
                retryDelay: this.settings.retryDelay || 1000,
                maxRetryDelay: this.settings.maxRetryDelay || 30000,
                timeout: this.settings.uploadTimeout || 60000
            }
        );

        // 设置删除配置
        this.uploadManager.setDeleteAfterUpload(this.settings.deleteAfterUpload || false);

        // 创建其他服务
        this.imageService = new ImageService(this.app, this.storageProvider);
        this.currentFileUploader = new CurrentFileUploader(this.app, this.storageProvider, this.uploadManager, this.settings);
        this.pasteHandler = new PasteHandler(this.app, this.storageProvider, this);
    }

    /**
     * 注册命令
     */
    private registerCommands(): void {
        // 上传所有笔记中的图片
        this.addCommand({
            id: 'upload-images-to-cloudflare',
            name: '上传所有笔记中的图片',
            callback: () => this.executeUpload(),
        });

        // 上传当前笔记中图片
        this.addCommand({
            id: 'upload-current-note-images',
            name: '上传当前笔记中的图片',
            callback: () => this.uploadCurrentNoteImages(),
        });

        // 取消所有上传
        this.addCommand({
            id: 'cancel-all-uploads',
            name: '取消所有上传任务',
            callback: () => {
                this.uploadManager.cancelAll();
                this.logger.notify('已取消所有上传任务', 3000);
            },
        });

        // 重试失败的上传
        this.addCommand({
            id: 'retry-failed-uploads',
            name: '重试失败的上传任务',
            callback: () => {
                this.uploadManager.retryFailed();
                this.logger.notify('已重新加入失败的任务到队列', 3000);
            },
        });
    }

    /**
     * 处理设置变更
     */
    private handleSettingsChange(): void {
        // 更新日志配置
        this.logger.setShowDetailedLogs(this.settings.showDetailedLogs || false);
        this.logger.setShowProgressNotifications(this.settings.showProgressNotifications ?? true);

        // 更新存储提供者
        this.storageProvider = this.createStorageProvider();

        // 更新上传管理器配置
        this.uploadManager.updateConfig({
            maxConcurrency: this.settings.maxConcurrentUploads || 3,
            maxRetries: this.settings.maxRetries || 3,
            retryDelay: this.settings.retryDelay || 1000,
            maxRetryDelay: this.settings.maxRetryDelay || 30000,
            timeout: this.settings.uploadTimeout || 60000
        });

        // 更新删除配置
        this.uploadManager.setDeleteAfterUpload(this.settings.deleteAfterUpload || false);

        // 重新创建服务
        this.imageService = new ImageService(this.app, this.storageProvider);
        this.currentFileUploader = new CurrentFileUploader(this.app, this.storageProvider, this.uploadManager, this.settings);

        // 处理自动粘贴功能的开关
        if (this.settings.enableAutoPaste) {
            this.pasteHandler.registerPasteEvent();
            this.logger.info('已启用自动粘贴上传功能');
        } else {
            this.pasteHandler.unregisterPasteEvent();
            this.logger.info('已禁用自动粘贴上传功能');
        }
    }

    /**
     * 创建存储提供者
     */
    private createStorageProvider(): StorageProvider {
        // 根据设置选择存储提供者
        switch (this.settings.storageProvider) {
            case StorageProviderType.R2_S3_API:
                if (!this.settings.r2S3Settings) {
                    throw new Error('R2 S3 API 设置未配置');
                }
                return new R2S3Service(this.settings.r2S3Settings);
            case StorageProviderType.CLOUDFLARE_WORKER:
            default:
                return new CloudflareWorkerService(this.settings);
        }
    }

    /**
     * 执行上传过程（所有笔记）
     */
    async executeUpload() {
        this.logger.info('开始执行上传过程');

        // 检查设置
        if (!this.validateSettings()) {
            return;
        }

        try {
            // 查找需要上传的图片
            const imagePathsToUpload = await this.imageService.findImagesToUpload();
            this.logger.info(`找到 ${imagePathsToUpload.size} 张图片需要上传`);

            if (imagePathsToUpload.size === 0) {
                this.logger.notify('没有新的图片需要上传', 3000);
                return;
            }

            // 添加到上传队列
            const imagePaths = Array.from(imagePathsToUpload);
            await this.uploadManager.addTasks(imagePaths);

            this.logger.notify(`已添加 ${imagePaths.length} 张图片到上传队列`, 3000);
        } catch (error) {
            this.logger.error('执行上传过程时出错', error);
            this.logger.notify('上传过程中出现错误，请查看控制台日志。', 5000);
        }
    }

    /**
     * 上传当前笔记中的图片
     */
    async uploadCurrentNoteImages() {
        this.logger.info('开始上传当前笔记中的图片');

        // 检查设置
        if (!this.validateSettings()) {
            return;
        }

        try {
            // 使用当前文件上传器处理当前文件
            const result = await this.currentFileUploader.processCurrentFile();

            if (result) {
                if (result.totalImages > 0) {
                    this.logger.notify(`处理完成: 成功上传 ${result.successCount} 张图片, 失败 ${result.failureCount} 张`, 3000);
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
     * 验证设置
     */
    private validateSettings(): boolean {
        switch (this.settings.storageProvider) {
            case StorageProviderType.R2_S3_API:
                if (!this.settings.r2S3Settings) {
                    this.logger.notify('请先在插件设置中完成 R2 S3 API 的配置。', 5000);
                    return false;
                }
                const {accountId, accessKeyId, secretAccessKey, bucketName} = this.settings.r2S3Settings;
                if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
                    this.logger.notify('请先在插件设置中完成 R2 S3 API 的配置。', 5000);
                    return false;
                }
                return true;
            case StorageProviderType.CLOUDFLARE_WORKER:
            default:
                const {workerUrl, apiKey} = this.settings.workerSettings;
                if (!workerUrl || !apiKey) {
                    this.logger.notify('请先在插件设置中完成 Cloudflare Worker 的配置。', 5000);
                    return false;
                }
                return true;
        }
    }
}
