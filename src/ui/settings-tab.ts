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

    // 显示Worker设置
    this.displayCloudflareWorkerSettings(containerEl);
  }

  /**
   * 显示Cloudflare Worker设置
   */
  private displayCloudflareWorkerSettings(containerEl: HTMLElement): void {
    containerEl.createEl('h3', { text: 'Cloudflare Worker 配置' });
    
    new Setting(containerEl)
      .setName('Worker URL')
      .setDesc('您部署的 Cloudflare Worker 的 URL')
      .addText(text => text
        .setPlaceholder('https://your-worker.your-subdomain.workers.dev')
        .setValue(this.plugin.settings.workerSettings.workerUrl)
        .onChange(async (value) => {
          this.plugin.settings.workerSettings.workerUrl = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('API Key')
      .setDesc('Worker 认证所需的 API Key')
      .addText(text => text
        .setPlaceholder('输入您的 API Key')
        .setValue(this.plugin.settings.workerSettings.apiKey)
        .onChange(async (value) => {
          this.plugin.settings.workerSettings.apiKey = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName('文件夹名称（可选）')
      .setDesc('上传文件的目标文件夹，如不填则使用 Worker 默认设置')
      .addText(text => text
        .setPlaceholder('images')
        .setValue(this.plugin.settings.workerSettings.folderName || '')
        .onChange(async (value) => {
          this.plugin.settings.workerSettings.folderName = value || undefined;
          await this.plugin.saveSettings();
        })
      );
  }
} 