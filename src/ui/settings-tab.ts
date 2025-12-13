/**
 * SettingsTab - Main settings tab orchestrator
 *
 * This is now a thin orchestrator that:
 * - Manages the settings tab lifecycle
 * - Renders intro and help sections
 * - Delegates to section components for settings groups
 */

import {App, Notice, PluginSettingTab, Setting} from 'obsidian';
import type {CloudflareImagesUploader} from '../core/main';
import {StorageProviderType} from '../types';
import {
    SectionDeps,
    BasicSection,
    WorkerSection,
    R2S3Section,
    AdvancedSection,
    LoggingSection
} from './sections';

export class SettingsTab extends PluginSettingTab {
    plugin: CloudflareImagesUploader;

    constructor(app: App, plugin: CloudflareImagesUploader) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        // Shared dependencies for all sections
        const deps: SectionDeps = {
            getSettings: () => this.plugin.settings,
            saveSettings: () => this.plugin.saveSettings()
        };

        // Render all sections
        this.renderIntro(containerEl);
        containerEl.createEl('hr');

        new BasicSection({
            ...deps,
            onProviderChange: () => this.display()
        }).render(containerEl);

        this.renderProviderSection(containerEl, deps);

        new AdvancedSection(deps).render(containerEl);
        new LoggingSection(deps).render(containerEl);

        this.renderHelp(containerEl);
    }

    /**
     * Render intro section with welcome and setup instructions
     */
    private renderIntro(container: HTMLElement): void {
        container.createEl('h1', {text: 'Cloudflare R2 Uploader 设置'});

        const introDiv = container.createDiv({cls: 'setting-item-description'});
        introDiv.createEl('p', {
            text: '请按照以下步骤配置您的 Cloudflare R2 存储：'
        });

        const ol = introDiv.createEl('ol');
        if (this.plugin.settings.storageProvider === StorageProviderType.CLOUDFLARE_WORKER) {
            ol.createEl('li', {text: '部署 Cloudflare R2 Worker（参考项目文档）'});
            ol.createEl('li', {text: '获取 Worker URL 和 API Key'});
            ol.createEl('li', {text: '在下方填写相关配置信息'});
            ol.createEl('li', {text: '保存设置后即可开始使用'});
        } else {
            ol.createEl('li', {text: '在 Cloudflare 控制台创建 R2 存储桶'});
            ol.createEl('li', {text: '创建 R2 API 令牌（需要 R2 Token 权限）'});
            ol.createEl('li', {text: '获取账户 ID、Access Key ID 和 Secret Access Key'});
            ol.createEl('li', {text: '在下方填写相关配置信息'});
            ol.createEl('li', {text: '保存设置后即可开始使用'});
        }
    }

    /**
     * Render provider-specific section based on current selection
     */
    private renderProviderSection(container: HTMLElement, deps: SectionDeps): void {
        if (this.plugin.settings.storageProvider === StorageProviderType.CLOUDFLARE_WORKER) {
            new WorkerSection(deps).render(container);
        } else {
            new R2S3Section(deps).render(container);
        }
    }

    /**
     * Render help section with links and validate button
     */
    private renderHelp(container: HTMLElement): void {
        container.createEl('hr');
        container.createEl('h2', {text: '帮助'});

        const helpDiv = container.createDiv({cls: 'setting-item-description'});
        helpDiv.createEl('p', {text: '如需帮助，请访问：'});

        const helpList = helpDiv.createEl('ul');
        helpList.createEl('li').createEl('a', {
            text: 'GitHub 项目主页',
            href: 'https://github.com/wangweiX/cloudflare-r2-uploader'
        });
        helpList.createEl('li').createEl('a', {
            text: 'Cloudflare R2 Worker 部署指南',
            href: 'https://github.com/wangweiX/cloudflare-r2-worker'
        });

        // Validate button
        new Setting(container)
            .setName('验证配置格式')
            .setDesc('检查当前存储提供者的配置是否完整')
            .addButton(button => button
                .setButtonText('验证配置')
                .onClick(async () => {
                    this.validateConfiguration();
                }));
    }

    /**
     * Validate the current configuration based on selected provider
     */
    private validateConfiguration(): void {
        const provider = this.plugin.settings.storageProvider;

        if (provider === StorageProviderType.CLOUDFLARE_WORKER) {
            this.validateWorkerConfig();
        } else {
            this.validateR2S3Config();
        }
    }

    /**
     * Validate Worker configuration
     */
    private validateWorkerConfig(): void {
        const {workerUrl, apiKey, bucketName} = this.plugin.settings.workerSettings;

        if (!workerUrl || !apiKey || !bucketName) {
            new Notice('请先填写所有必需的 Worker 配置项（URL、API Key、存储桶名称）');
            return;
        }

        const urlRegex = /^https?:\/\/.+/;
        if (!urlRegex.test(workerUrl)) {
            new Notice('Worker URL 格式不正确，应以 http:// 或 https:// 开头');
            return;
        }

        new Notice('Worker 配置验证成功！');
    }

    /**
     * Validate R2 S3 API configuration
     */
    private validateR2S3Config(): void {
        const r2Settings = this.plugin.settings.r2S3Settings;

        if (!r2Settings) {
            new Notice('请先填写 R2 S3 API 配置');
            return;
        }

        const {accountId, accessKeyId, secretAccessKey, bucketName} = r2Settings;

        if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
            new Notice('请先填写所有必需的 R2 配置项（账户 ID、Access Key、Secret Key、存储桶名称）');
            return;
        }

        new Notice('R2 S3 API 配置验证成功！');
    }
}
