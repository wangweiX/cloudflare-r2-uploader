import {addIcon, Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, PluginSettings} from '../models/settings';
import {CloudflareWorkerService} from '../services/worker-service';
import {ImageService} from '../services/image-service';
import {PasteHandler} from '../services/paste-handler';
import {CurrentFileUploader} from '../services/current-file-uploader';
import {SettingsTab} from '../ui/settings-tab';
import {Logger} from '../utils/logger';
import {StorageProvider} from '../models/storage-provider';

// 上传当前文件按钮的图标
const UPLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100" height="100" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;

/**
 * 插件主类
 */
export class CloudflareImagesUploader extends Plugin {
    public settings: PluginSettings = DEFAULT_SETTINGS;
    private storageProvider!: StorageProvider;
    private imageService!: ImageService;
    private pasteHandler!: PasteHandler;
    private currentFileUploader!: CurrentFileUploader;
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

        // 初始化服务
        this.storageProvider = this.createStorageProvider();
        this.imageService = new ImageService(this.app, this.storageProvider);
        this.pasteHandler = new PasteHandler(this.app, this.storageProvider, this);
        this.currentFileUploader = new CurrentFileUploader(this.app, this.storageProvider);

        // 添加设置选项卡
        this.addSettingTab(new SettingsTab(this.app, this));

        // 添加上传命令
        this.addCommand({
            id: 'upload-images-to-cloudflare',
            name: '上传所有笔记中的图片',
            callback: () => this.executeUpload(),
        });

        // 添加上传当前笔记中图片的命令
        this.addCommand({
            id: 'upload-current-note-images',
            name: '上传当前笔记中的图片',
            callback: () => this.uploadCurrentNoteImages(),
        });

        // 添加上传当前笔记图片的图标按钮
        addIcon('upload-images', UPLOAD_ICON);
        this.addRibbonIcon('upload-images', '上传当前笔记中的图片', () => {
            this.uploadCurrentNoteImages();
        });

        // 根据设置决定是否启用自动粘贴上传功能
        if (this.settings.enableAutoPaste) {
            this.pasteHandler.registerPasteEvent();
            this.logger.info('已启用自动粘贴上传功能');
        }

        // 监听设置更改
        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                // 在布局变化时检查设置变更
                const currentProvider = this.createStorageProvider();
                if (currentProvider.getType() !== this.storageProvider.getType()) {
                    // 如果存储提供者类型发生变化，则更新各个服务
                    this.storageProvider = currentProvider;
                    this.imageService = new ImageService(this.app, this.storageProvider);
                    this.currentFileUploader = new CurrentFileUploader(this.app, this.storageProvider);
                }

                // 处理自动粘贴功能的开关
                if (this.settings.enableAutoPaste) {
                    this.pasteHandler.registerPasteEvent();
                    this.logger.info('已启用自动粘贴上传功能');
                } else {
                    this.pasteHandler.unregisterPasteEvent();
                    this.logger.info('已禁用自动粘贴上传功能');
                }
            })
        );
    }

    /**
     * 插件卸载
     */
    async onunload() {
        this.logger.info('卸载 Cloudflare Images Uploader 插件');

        // 取消注册事件
        this.pasteHandler.unregisterPasteEvent();
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
     * 处理设置变更
     */
    private handleSettingsChange(): void {
        // 更新存储提供者
        this.storageProvider = this.createStorageProvider();
        this.imageService = new ImageService(this.app, this.storageProvider);
        this.currentFileUploader = new CurrentFileUploader(this.app, this.storageProvider);

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
        // 只支持Worker存储提供者
        return new CloudflareWorkerService(this.settings);
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

            // 上传图片
            const newMappings = await this.imageService.uploadImages(Array.from(imagePathsToUpload));

            // 更新图片服务中的映射数据
            this.imageService = new ImageService(this.app, this.storageProvider);

            // 更新笔记中的链接
            await this.imageService.updateNotes(newMappings);

            this.logger.notify('图片处理完成', 3000);
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
        const {workerUrl, apiKey} = this.settings.workerSettings;
        if (!workerUrl || !apiKey) {
            this.logger.notify('请先在插件设置中完成 Cloudflare Worker 的配置。', 5000);
            return false;
        }
        return true;
    }
} 