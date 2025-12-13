/**
 * BasicSection - Provider selection and basic toggles
 */

import {Setting} from 'obsidian';
import {BasePluginSettings, PluginSettings, StorageProviderType} from '../../types';
import {createR2S3Settings, createWorkerSettings} from '../../config';
import {BaseSection, SectionDeps} from './base-section';
import {createToggleInput} from '../helpers';

/**
 * Callback for when provider changes (to re-render the page)
 */
export interface BasicSectionDeps extends SectionDeps {
    onProviderChange: () => void;
    setSettings: (settings: PluginSettings) => void;
}

export class BasicSection extends BaseSection {
    constructor(protected readonly deps: BasicSectionDeps) {
        super(deps);
    }

    public render(container: HTMLElement): void {
        this.createHeading(container, '基础设置');

        // Storage provider dropdown
        new Setting(container)
            .setName('存储提供者')
            .setDesc('选择图片上传的存储服务')
            .addDropdown(dropdown => {
                dropdown
                    .addOption(StorageProviderType.CLOUDFLARE_WORKER, 'Cloudflare Worker')
                    .addOption(StorageProviderType.R2_S3_API, 'R2 S3 API (直连)')
                    .setValue(this.settings.storageProvider)
                    .onChange(async (value: string) => {
                        const newProvider = value as StorageProviderType;
                        if (newProvider !== this.settings.storageProvider) {
                            // Create new settings with the new provider type
                            const newSettings = this.createSettingsForProvider(newProvider);
                            this.deps.setSettings(newSettings);
                            await this.save();
                            this.deps.onProviderChange();
                        }
                    });
            });

        // Auto-paste toggle
        createToggleInput(container, {
            name: '启用自动粘贴上传',
            desc: '启用后，粘贴图片时自动上传到 Cloudflare R2',
            getValue: () => this.settings.enableAutoPaste,
            setValue: async (value) => {
                this.settings.enableAutoPaste = value;
                await this.save();
            }
        });

        // Delete after upload toggle
        createToggleInput(container, {
            name: '上传成功后删除本地图片',
            desc: '启用后，图片上传成功后会自动删除本地图片文件',
            getValue: () => this.settings.deleteAfterUpload,
            setValue: async (value) => {
                this.settings.deleteAfterUpload = value;
                await this.save();
            }
        });
    }

    /**
     * Create new settings object for the given provider type.
     * Preserves base settings (toggles, limits, etc.) while creating provider-specific defaults.
     */
    private createSettingsForProvider(provider: StorageProviderType): PluginSettings {
        // Extract base settings from current settings
        const baseSettings: Partial<BasePluginSettings> = {
            enableAutoPaste: this.settings.enableAutoPaste,
            deleteAfterUpload: this.settings.deleteAfterUpload,
            maxConcurrentUploads: this.settings.maxConcurrentUploads,
            maxRetries: this.settings.maxRetries,
            retryDelay: this.settings.retryDelay,
            maxRetryDelay: this.settings.maxRetryDelay,
            uploadTimeout: this.settings.uploadTimeout,
            showDetailedLogs: this.settings.showDetailedLogs,
            showProgressNotifications: this.settings.showProgressNotifications
        };

        // Create new settings with appropriate provider type
        if (provider === StorageProviderType.R2_S3_API) {
            return createR2S3Settings(baseSettings);
        }

        return createWorkerSettings(baseSettings);
    }
}
