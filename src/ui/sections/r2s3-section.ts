/**
 * R2S3Section - R2 S3 API settings
 */

import {isR2S3Provider} from '../../types';
import {BaseSection} from './base-section';
import {createPasswordInput, createTextInput} from '../helpers';

export class R2S3Section extends BaseSection {
    public render(container: HTMLElement): void {
        this.createHeading(container, 'R2 S3 API 设置');

        // Type guard ensures we have R2S3ProviderSettings
        if (!isR2S3Provider(this.settings)) {
            container.createEl('p', {text: '错误：当前不是 R2 S3 API 存储提供者'});
            return;
        }

        const r2Settings = this.settings.r2S3Settings;

        // Help info
        const helpDiv = this.createDescription(container);
        helpDiv.createEl('p', {
            text: '提示：在 Cloudflare 控制台右侧可以找到账户 ID。创建 R2 API 令牌时，请选择 "对象读和写" 权限。'
        });

        // CORS info
        const corsDiv = this.createDescription(container);
        corsDiv.createEl('p', {
            text: '注意：如果遇到 CORS 错误，这是正常现象。插件会自动重试，通常第二次就能成功。这是由于 R2 的 CORS 策略导致的。'
        });

        // Account ID
        createTextInput(container, {
            name: '账户 ID',
            desc: '您的 Cloudflare 账户 ID（在控制台右侧可找到）',
            placeholder: '输入您的账户 ID',
            getValue: () => r2Settings.accountId,
            setValue: async (value) => {
                r2Settings.accountId = value;
                await this.save();
            }
        });

        // Access Key ID
        createTextInput(container, {
            name: 'Access Key ID',
            desc: 'R2 API 令牌的 Access Key ID',
            placeholder: '输入您的 Access Key ID',
            getValue: () => r2Settings.accessKeyId,
            setValue: async (value) => {
                r2Settings.accessKeyId = value;
                await this.save();
            }
        });

        // Secret Access Key
        createPasswordInput(container, {
            name: 'Secret Access Key',
            desc: 'R2 API 令牌的 Secret Access Key',
            placeholder: '输入您的 Secret Access Key',
            getValue: () => r2Settings.secretAccessKey,
            setValue: async (value) => {
                r2Settings.secretAccessKey = value;
                await this.save();
            }
        });

        // Bucket name
        createTextInput(container, {
            name: '存储桶名称',
            desc: 'Cloudflare R2 存储桶的名称',
            placeholder: '输入您的存储桶名称',
            getValue: () => r2Settings.bucketName,
            setValue: async (value) => {
                r2Settings.bucketName = value;
                await this.save();
            }
        });

        // Folder name (optional)
        createTextInput(container, {
            name: '文件夹名称（可选）',
            desc: '上传图片到指定文件夹，留空则上传到根目录',
            placeholder: '请输入上传的文件夹名称',
            getValue: () => r2Settings.folderName || '',
            setValue: async (value) => {
                r2Settings.folderName = value;
                await this.save();
            }
        });

        // Custom domain (optional)
        createTextInput(container, {
            name: '自定义域名（可选）',
            desc: '如果您为 R2 配置了自定义域名，请在此输入',
            placeholder: 'https://images.yourdomain.com',
            getValue: () => r2Settings.customDomain || '',
            setValue: async (value) => {
                r2Settings.customDomain = value;
                await this.save();
            }
        });
    }
}
