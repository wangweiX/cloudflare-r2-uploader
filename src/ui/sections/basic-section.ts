/**
 * BasicSection - Provider selection and basic toggles
 */

import {Setting} from 'obsidian';
import {StorageProviderType} from '../../types';
import {BaseSection, SectionDeps} from './base-section';
import {createToggleInput} from '../helpers';

/**
 * Callback for when provider changes (to re-render the page)
 */
export interface BasicSectionDeps extends SectionDeps {
    onProviderChange: () => void;
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
                        this.settings.storageProvider = value as StorageProviderType;
                        await this.save();
                        this.deps.onProviderChange();
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
}
