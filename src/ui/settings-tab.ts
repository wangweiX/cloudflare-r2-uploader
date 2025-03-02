import { App, PluginSettingTab, Setting } from 'obsidian';
import { CloudflareImagesUploader } from '../core/main';
import { StorageProviderType } from '../models/storage-provider';

/**
 * 设置选项卡 - 负责插件设置界面
 */
export class SettingsTab extends PluginSettingTab {
  /**
   * 构造函数
   */
  constructor(app: App, private plugin: CloudflareImagesUploader) {
    super(app, plugin);
  }

  /**
   * 显示设置界面
   */
  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Cloudflare 图片上传器设置' });

    // 存储提供者选择
    new Setting(containerEl)
      .setName('存储提供者')
      .setDesc('选择要使用的图片存储提供者')
      .addDropdown(dropdown => {
        dropdown
          .addOption(StorageProviderType.CLOUDFLARE_IMAGES, 'Cloudflare Images')
          .addOption(StorageProviderType.CLOUDFLARE_R2, 'Cloudflare R2')
          .setValue(this.plugin.settings.storageProvider)
          .onChange(async (value) => {
            this.plugin.settings.storageProvider = value as StorageProviderType;
            await this.plugin.saveSettings();
            // 刷新设置界面以显示相应的配置选项
            this.display();
          });
      });

    // 自动粘贴上传设置
    new Setting(containerEl)
      .setName('启用自动粘贴上传')
      .setDesc('粘贴图片时自动上传到Cloudflare并替换为链接')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.enableAutoPaste)
          .onChange(async (value) => {
            this.plugin.settings.enableAutoPaste = value;
            await this.plugin.saveSettings();
          });
      });

    // 根据选择的存储提供者显示相应的设置
    if (this.plugin.settings.storageProvider === StorageProviderType.CLOUDFLARE_IMAGES) {
      this.displayCloudflareImagesSettings(containerEl);
    } else if (this.plugin.settings.storageProvider === StorageProviderType.CLOUDFLARE_R2) {
      this.displayCloudflareR2Settings(containerEl);
    }
  }

  /**
   * 显示Cloudflare Images设置
   */
  private displayCloudflareImagesSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Cloudflare Images 配置' });

    new Setting(containerEl)
      .setName('账户 ID')
      .setDesc('您的 Cloudflare 账户 ID')
      .addText(text => text
        .setPlaceholder('输入您的账户 ID')
        .setValue(this.plugin.settings.accountId)
        .onChange(async (value) => {
          this.plugin.settings.accountId = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('API 令牌')
      .setDesc('具有 Images 权限的 Cloudflare API 令牌')
      .addText(text => text
        .setPlaceholder('输入您的 API 令牌')
        .setValue(this.plugin.settings.apiToken)
        .onChange(async (value) => {
          this.plugin.settings.apiToken = value;
          await this.plugin.saveSettings();
        })
      );
  }

  /**
   * 显示Cloudflare R2设置
   */
  private displayCloudflareR2Settings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Cloudflare R2 配置' });

    new Setting(containerEl)
      .setName('账户 ID')
      .setDesc('您的 Cloudflare 账户 ID')
      .addText(text => text
        .setPlaceholder('输入您的账户 ID')
        .setValue(this.plugin.settings.r2Settings.accountId)
        .onChange(async (value) => {
          this.plugin.settings.r2Settings.accountId = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('API 令牌')
      .setDesc('具有 R2 权限的 Cloudflare API 令牌')
      .addText(text => text
        .setPlaceholder('输入您的 API 令牌')
        .setValue(this.plugin.settings.r2Settings.apiToken)
        .onChange(async (value) => {
          this.plugin.settings.r2Settings.apiToken = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('存储桶名称')
      .setDesc('R2 存储桶的名称')
      .addText(text => text
        .setPlaceholder('输入存储桶名称')
        .setValue(this.plugin.settings.r2Settings.bucket)
        .onChange(async (value) => {
          this.plugin.settings.r2Settings.bucket = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('自定义域名（可选）')
      .setDesc('访问 R2 对象的自定义域名，包括协议前缀（例如：https://images.example.com）')
      .addText(text => text
        .setPlaceholder('https://images.example.com')
        .setValue(this.plugin.settings.r2Settings.customDomain || '')
        .onChange(async (value) => {
          this.plugin.settings.r2Settings.customDomain = value || undefined;
          await this.plugin.saveSettings();
        })
      );

    containerEl.createEl('h4', { text: 'S3 API 凭证（可选，用于解决 CORS 问题）' });
    containerEl.createEl('p', { 
      text: '如果使用 API 令牌上传遇到 CORS 问题，可以改用 S3 API 凭证上传。请在 Cloudflare R2 控制面板创建 API 令牌，并填入以下字段。' 
    });

    new Setting(containerEl)
      .setName('Access Key ID')
      .setDesc('S3 API Access Key ID')
      .addText(text => text
        .setPlaceholder('输入 Access Key ID')
        .setValue(this.plugin.settings.r2Settings.accessKeyId || '')
        .onChange(async (value) => {
          this.plugin.settings.r2Settings.accessKeyId = value || undefined;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('Secret Access Key')
      .setDesc('S3 API Secret Access Key')
      .addText(text => text
        .setPlaceholder('输入 Secret Access Key')
        .setValue(this.plugin.settings.r2Settings.secretAccessKey || '')
        .onChange(async (value) => {
          this.plugin.settings.r2Settings.secretAccessKey = value || undefined;
          await this.plugin.saveSettings();
        })
      );
  }
} 