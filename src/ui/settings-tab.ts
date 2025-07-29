import {App, PluginSettingTab, Setting, Notice} from 'obsidian';
import {CloudflareImagesUploader} from '../core/main';

/**
 * 设置选项卡
 */
export class SettingsTab extends PluginSettingTab {
    plugin: CloudflareImagesUploader;

    constructor(app: App, plugin: CloudflareImagesUploader) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        // 创建欢迎标题
        containerEl.createEl('h1', {text: 'Cloudflare R2 Uploader 设置'});

        // 创建引导说明
        const introDiv = containerEl.createDiv({cls: 'setting-item-description'});
        introDiv.createEl('p', {
            text: '请按照以下步骤配置您的 Cloudflare R2 存储：'
        });
        
        const ol = introDiv.createEl('ol');
        ol.createEl('li', {text: '部署 Cloudflare R2 Worker（参考项目文档）'});
        ol.createEl('li', {text: '获取 Worker URL 和 API Key'});
        ol.createEl('li', {text: '在下方填写相关配置信息'});
        ol.createEl('li', {text: '保存设置后即可开始使用'});

        containerEl.createEl('hr');

        // 分组标题
        containerEl.createEl('h2', {text: '基础设置'});

        // 自动粘贴上传设置
        new Setting(containerEl)
            .setName('启用自动粘贴上传')
            .setDesc('启用后，粘贴图片时自动上传到 Cloudflare R2')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.enableAutoPaste)
                    .onChange(async (value) => {
                        this.plugin.settings.enableAutoPaste = value;
                        await this.plugin.saveSettings();
                    });
            });

        // 上传后删除本地图片设置
        new Setting(containerEl)
            .setName('上传成功后删除本地图片')
            .setDesc('启用后，图片上传成功后会自动删除本地图片文件')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.deleteAfterUpload)
                    .onChange(async (value) => {
                        this.plugin.settings.deleteAfterUpload = value;
                        await this.plugin.saveSettings();
                    });
            });

        // Cloudflare Worker 设置分组
        containerEl.createEl('h2', {text: 'Cloudflare Worker 设置'});

        // Worker URL
        new Setting(containerEl)
            .setName('Worker URL')
            .setDesc('您部署的 Cloudflare R2 Worker 的 URL')
            .addText(text => text
                .setPlaceholder('https://your-worker.your-subdomain.workers.dev')
                .setValue(this.plugin.settings.workerSettings.workerUrl)
                .onChange(async (value) => {
                    // 只保存值，不进行实时验证
                    this.plugin.settings.workerSettings.workerUrl = value.trim();
                    await this.plugin.saveSettings();
                }));

        // API Key
        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Worker 的 API 密钥（在 Worker 环境变量中设置）')
            .addText(text => {
                // 将文本框转换为密码框
                const wrapTextWithPasswordHide = (text: any) => {
                    text.inputEl.type = 'password';
                    text.inputEl.autocomplete = 'off';
                };
                wrapTextWithPasswordHide(text);
                text.setPlaceholder('输入您的 API Key')
                    .setValue(this.plugin.settings.workerSettings.apiKey)
                    .onChange(async (value) => {
                        // 只保存值，不进行实时验证
                        this.plugin.settings.workerSettings.apiKey = value.trim();
                        await this.plugin.saveSettings();
                    });
            });

        // 存储桶名称
        new Setting(containerEl)
            .setName('存储桶名称')
            .setDesc('Cloudflare R2 存储桶的名称')
            .addText(text => text
                .setPlaceholder('输入您的存储桶名称')
                .setValue(this.plugin.settings.workerSettings.bucketName)
                .onChange(async (value) => {
                    // 只保存值，不进行实时验证
                    this.plugin.settings.workerSettings.bucketName = value.trim();
                    await this.plugin.saveSettings();
                }));

        // 文件夹名称（可选）
        new Setting(containerEl)
            .setName('文件夹名称（可选）')
            .setDesc('上传图片到指定文件夹，留空则上传到根目录')
            .addText(text => text
                .setPlaceholder('请输入上传的文件夹名称')
                .setValue(this.plugin.settings.workerSettings.folderName || '')
                .onChange(async (value) => {
                    // 只保存值
                    this.plugin.settings.workerSettings.folderName = value.trim();
                    await this.plugin.saveSettings();
                }));

        // 自定义域名（可选）
        new Setting(containerEl)
            .setName('自定义域名（可选）')
            .setDesc('如果您为 R2 配置了自定义域名，请在此输入')
            .addText(text => text
                .setPlaceholder('https://images.yourdomain.com')
                .setValue(this.plugin.settings.workerSettings.customDomain || '')
                .onChange(async (value) => {
                    // 只保存值
                    this.plugin.settings.workerSettings.customDomain = value.trim();
                    await this.plugin.saveSettings();
                }));

        // 高级设置分组
        containerEl.createEl('h2', {text: '高级设置'});

        // 并发上传数
        new Setting(containerEl)
            .setName('最大并发上传数')
            .setDesc('同时上传的最大文件数量（1-50）')
            .addText(text => text
                .setPlaceholder('3')
                .setValue(String(this.plugin.settings.maxConcurrentUploads || 3))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 1 && num <= 50) {
                        this.plugin.settings.maxConcurrentUploads = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // 最大重试次数
        new Setting(containerEl)
            .setName('最大重试次数')
            .setDesc('上传失败时的最大重试次数（0-5）')
            .addText(text => text
                .setPlaceholder('3')
                .setValue(String(this.plugin.settings.maxRetries || 3))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 0 && num <= 5) {
                        this.plugin.settings.maxRetries = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // 重试延迟
        new Setting(containerEl)
            .setName('重试延迟（毫秒）')
            .setDesc('重试前的等待时间（100-10000）')
            .addText(text => text
                .setPlaceholder('1000')
                .setValue(String(this.plugin.settings.retryDelay || 1000))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 100 && num <= 10000) {
                        this.plugin.settings.retryDelay = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // 上传超时
        new Setting(containerEl)
            .setName('上传超时（毫秒）')
            .setDesc('单个文件上传的超时时间（10000-300000）')
            .addText(text => text
                .setPlaceholder('60000')
                .setValue(String(this.plugin.settings.uploadTimeout || 60000))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num >= 10000 && num <= 300000) {
                        this.plugin.settings.uploadTimeout = num;
                        await this.plugin.saveSettings();
                    }
                }));

        // 日志设置分组
        containerEl.createEl('h2', {text: '日志设置'});

        // 详细日志
        new Setting(containerEl)
            .setName('显示详细日志')
            .setDesc('在控制台输出详细的调试日志')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.showDetailedLogs || false)
                    .onChange(async (value) => {
                        this.plugin.settings.showDetailedLogs = value;
                        await this.plugin.saveSettings();
                    });
            });

        // 进度通知
        new Setting(containerEl)
            .setName('显示上传进度通知')
            .setDesc('显示文件上传进度的通知')
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.showProgressNotifications ?? true)
                    .onChange(async (value) => {
                        this.plugin.settings.showProgressNotifications = value;
                        await this.plugin.saveSettings();
                    });
            });

        // 帮助信息
        containerEl.createEl('hr');
        containerEl.createEl('h2', {text: '帮助'});
        
        const helpDiv = containerEl.createDiv({cls: 'setting-item-description'});
        helpDiv.createEl('p', {
            text: '如需帮助，请访问：'
        });
        
        const helpList = helpDiv.createEl('ul');
        helpList.createEl('li').createEl('a', {
            text: 'GitHub 项目主页',
            href: 'https://github.com/wangweiX/obsidian-cloudflare-r2-uploader'
        });
        helpList.createEl('li').createEl('a', {
            text: 'Cloudflare R2 Worker 部署指南',
            href: 'https://github.com/wangweiX/cloudflare-r2-worker'
        });

        // 验证设置按钮
        new Setting(containerEl)
            .setName('验证配置')
            .setDesc('测试与 Cloudflare Worker 的连接')
            .addButton(button => button
                .setButtonText('验证连接')
                .onClick(async () => {
                    // 验证配置
                    const {workerUrl, apiKey, bucketName} = this.plugin.settings.workerSettings;
                    
                    if (!workerUrl || !apiKey || !bucketName) {
                        new Notice('请先填写所有必需的配置项');
                        return;
                    }

                    // 简单的格式验证
                    const urlRegex = /^https?:\/\/.+/;
                    if (!urlRegex.test(workerUrl)) {
                        new Notice('Worker URL 格式不正确，应以 http:// 或 https:// 开头');
                        return;
                    }

                    new Notice('配置验证成功！可以开始使用了。');
                }));
    }
}