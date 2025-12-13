/**
 * WorkerSection - Cloudflare Worker settings
 */

import {BaseSection} from './base-section';
import {createTextInput, createPasswordInput} from '../helpers';

export class WorkerSection extends BaseSection {
    public render(container: HTMLElement): void {
        this.createHeading(container, 'Cloudflare Worker 设置');

        const workerSettings = this.settings.workerSettings;

        // Worker URL
        createTextInput(container, {
            name: 'Worker URL',
            desc: '您部署的 Cloudflare R2 Worker 的 URL',
            placeholder: 'https://your-worker.your-subdomain.workers.dev',
            getValue: () => workerSettings.workerUrl,
            setValue: async (value) => {
                workerSettings.workerUrl = value;
                await this.save();
            }
        });

        // API Key
        createPasswordInput(container, {
            name: 'API Key',
            desc: 'Worker 的 API 密钥（在 Worker 环境变量中设置）',
            placeholder: '输入您的 API Key',
            getValue: () => workerSettings.apiKey,
            setValue: async (value) => {
                workerSettings.apiKey = value;
                await this.save();
            }
        });

        // Bucket name
        createTextInput(container, {
            name: '存储桶名称',
            desc: 'Cloudflare R2 存储桶的名称',
            placeholder: '输入您的存储桶名称',
            getValue: () => workerSettings.bucketName,
            setValue: async (value) => {
                workerSettings.bucketName = value;
                await this.save();
            }
        });

        // Folder name (optional)
        createTextInput(container, {
            name: '文件夹名称（可选）',
            desc: '上传图片到指定文件夹，留空则上传到根目录',
            placeholder: '请输入上传的文件夹名称',
            getValue: () => workerSettings.folderName || '',
            setValue: async (value) => {
                workerSettings.folderName = value;
                await this.save();
            }
        });

        // Custom domain (optional)
        createTextInput(container, {
            name: '自定义域名（可选）',
            desc: '如果您为 R2 配置了自定义域名，请在此输入',
            placeholder: 'https://images.yourdomain.com',
            getValue: () => workerSettings.customDomain || '',
            setValue: async (value) => {
                workerSettings.customDomain = value;
                await this.save();
            }
        });
    }
}
