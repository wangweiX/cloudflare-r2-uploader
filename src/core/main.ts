import {addIcon, Plugin} from 'obsidian';
import {
    DEFAULT_BASE_SETTINGS,
    DEFAULT_R2S3_SETTINGS,
    DEFAULT_SETTINGS,
    DEFAULT_WORKER_SETTINGS,
    UPLOAD_ICON
} from '../config';
import {isR2S3Provider, isWorkerProvider, PluginSettings, StorageProvider, StorageProviderType} from '../types';
import {CloudflareWorkerService, R2S3Service} from '../providers';
import {CommandHandler, PasteHandler} from '../handlers';
import {CurrentFileUploader, UploadManager, VaultUploader} from '../upload';
import {SettingsTab} from '../ui/settings-tab';
import {Logger} from '../utils';

/**
 * CloudflareImagesUploader - Main plugin class
 *
 * This is now a thin orchestrator that:
 * - Manages plugin lifecycle (onload/onunload)
 * - Initializes and wires up services
 * - Delegates command handling to CommandHandler
 * - Delegates paste handling to PasteHandler
 */
export class CloudflareImagesUploader extends Plugin {
    public settings: PluginSettings = DEFAULT_SETTINGS;

    private logger!: Logger;
    private storageProvider!: StorageProvider;
    private uploadManager!: UploadManager;
    private currentFileUploader!: CurrentFileUploader;
    private vaultUploader!: VaultUploader;
    private pasteHandler!: PasteHandler;
    private commandHandler!: CommandHandler;

    // ===== Plugin Lifecycle =====

    async onload(): Promise<void> {
        this.logger = Logger.getInstance();
        this.logger.info('加载 Cloudflare Images Uploader 插件');

        await this.loadSettings();
        this.applyLoggerSettings();
        this.initializeServices();
        this.setupUI();

        if (this.settings.enableAutoPaste) {
            this.pasteHandler.register();
            this.logger.info('已启用自动粘贴上传功能');
        }
    }

    async onunload(): Promise<void> {
        this.logger.info('卸载 Cloudflare Images Uploader 插件');

        this.uploadManager?.cancelAll();
        this.pasteHandler?.unregister();
        UploadManager.destroyInstance();
    }

    // ===== Settings =====

    async loadSettings(): Promise<void> {
        const savedData = await this.loadData();
        this.settings = this.migrateSettings(savedData);
    }

    /**
     * Migrate settings from old format (both providers stored) to new format (discriminated union).
     * Also handles first-time initialization when no saved data exists.
     */
    private migrateSettings(savedData: any): PluginSettings {
        if (!savedData) {
            return DEFAULT_SETTINGS;
        }

        // Extract base settings that are common to both providers
        const baseSettings = {
            enableAutoPaste: savedData.enableAutoPaste ?? DEFAULT_BASE_SETTINGS.enableAutoPaste,
            deleteAfterUpload: savedData.deleteAfterUpload ?? DEFAULT_BASE_SETTINGS.deleteAfterUpload,
            maxConcurrentUploads: savedData.maxConcurrentUploads ?? DEFAULT_BASE_SETTINGS.maxConcurrentUploads,
            maxRetries: savedData.maxRetries ?? DEFAULT_BASE_SETTINGS.maxRetries,
            retryDelay: savedData.retryDelay ?? DEFAULT_BASE_SETTINGS.retryDelay,
            maxRetryDelay: savedData.maxRetryDelay ?? DEFAULT_BASE_SETTINGS.maxRetryDelay,
            uploadTimeout: savedData.uploadTimeout ?? DEFAULT_BASE_SETTINGS.uploadTimeout,
            showDetailedLogs: savedData.showDetailedLogs ?? DEFAULT_BASE_SETTINGS.showDetailedLogs,
            showProgressNotifications: savedData.showProgressNotifications ?? DEFAULT_BASE_SETTINGS.showProgressNotifications
        };

        // Determine provider type and create appropriate settings
        const providerType = savedData.storageProvider ?? StorageProviderType.CLOUDFLARE_WORKER;

        if (providerType === StorageProviderType.R2_S3_API) {
            return {
                storageProvider: StorageProviderType.R2_S3_API,
                r2S3Settings: savedData.r2S3Settings ?? {...DEFAULT_R2S3_SETTINGS},
                ...baseSettings
            };
        }

        // Default to Worker provider
        return {
            storageProvider: StorageProviderType.CLOUDFLARE_WORKER,
            workerSettings: savedData.workerSettings ?? {...DEFAULT_WORKER_SETTINGS},
            ...baseSettings
        };
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        this.handleSettingsChange();
    }

    private applyLoggerSettings(): void {
        this.logger.setShowDetailedLogs(this.settings.showDetailedLogs || false);
        this.logger.setShowProgressNotifications(this.settings.showProgressNotifications ?? true);
    }

    // ===== Service Initialization =====

    private initializeServices(): void {
        // Create storage provider
        this.storageProvider = this.createStorageProvider();

        // Create upload manager (singleton)
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

        // Create current file uploader
        this.currentFileUploader = new CurrentFileUploader(
            this.app,
            this.uploadManager,
            this.settings
        );

        // Create vault uploader (uses latest settings via getter)
        this.vaultUploader = new VaultUploader(
            this.app,
            this.uploadManager,
            () => this.settings
        );

        // Create handlers
        this.pasteHandler = new PasteHandler(
            this.app,
            () => this.storageProvider,
            this
        );

        this.commandHandler = new CommandHandler({
            plugin: this,
            getSettings: () => this.settings,
            getUploadManager: () => this.uploadManager,
            getCurrentFileUploader: () => this.currentFileUploader,
            getVaultUploader: () => this.vaultUploader
        });
    }

    private createStorageProvider(): StorageProvider {
        if (isR2S3Provider(this.settings)) {
            return new R2S3Service(this.settings.r2S3Settings);
        }

        if (isWorkerProvider(this.settings)) {
            return new CloudflareWorkerService(this.settings);
        }

        // Should never reach here with proper discriminated union
        throw new Error(`Unknown storage provider type: ${(this.settings as any).storageProvider}`);
    }

    // ===== UI Setup =====

    private setupUI(): void {
        // Add settings tab
        this.addSettingTab(new SettingsTab(this.app, this));

        // Register icon
        addIcon('upload-images', UPLOAD_ICON);

        // Register commands
        this.commandHandler.registerCommands();

        // Add ribbon icon (goes through CommandHandler for consistent validation)
        this.addRibbonIcon('upload-images', '上传当前笔记中的图片', () => {
            this.commandHandler.uploadCurrentNoteImages().catch(err => {
                this.logger.error('上传当前笔记中的图片失败', err);
            });
        });
    }

    // ===== Settings Change Handler =====

    private handleSettingsChange(): void {
        this.applyLoggerSettings();

        // Check if provider type changed
        const previousProviderType = this.storageProvider.getType();
        const newProviderType = this.settings.storageProvider;

        // Recreate storage provider
        this.storageProvider = this.createStorageProvider();

        // Update upload manager if provider type changed
        if (previousProviderType !== newProviderType) {
            this.uploadManager.updateStorageProvider(this.storageProvider);
        }

        // Update upload manager config
        this.uploadManager.updateConfig({
            maxConcurrency: this.settings.maxConcurrentUploads || 3,
            maxRetries: this.settings.maxRetries || 3,
            retryDelay: this.settings.retryDelay || 1000,
            maxRetryDelay: this.settings.maxRetryDelay || 30000,
            timeout: this.settings.uploadTimeout || 60000
        });

        // Recreate current file uploader with new settings
        this.currentFileUploader = new CurrentFileUploader(
            this.app,
            this.uploadManager,
            this.settings
        );

        // Handle auto-paste toggle
        if (this.settings.enableAutoPaste) {
            this.pasteHandler.register();
            this.logger.info('已启用自动粘贴上传功能');
        } else {
            this.pasteHandler.unregister();
            this.logger.info('已禁用自动粘贴上传功能');
        }
    }
}
