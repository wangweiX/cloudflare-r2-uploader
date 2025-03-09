import {App, PluginSettingTab, setIcon, Setting, TextComponent, Notice} from 'obsidian';
import {CloudflareImagesUploader} from '../core/main';

const wrapTextWithPasswordHide = (text: TextComponent) => {
    const hider = text.inputEl.insertAdjacentElement(
        "beforebegin",
        createSpan()
    );
    if (!hider) {
        return;
    }
    setIcon(hider as HTMLElement, "eye-off");

    hider.addEventListener("click", () => {
        const isText = text.inputEl.getAttribute("type") === "text";
        if (isText) {
            setIcon(hider as HTMLElement, "eye-off");
            text.inputEl.setAttribute("type", "password");
        } else {
            setIcon(hider as HTMLElement, "eye");
            text.inputEl.setAttribute("type", "text");
        }
        text.inputEl.focus();
    });
    text.inputEl.setAttribute("type", "password");
    return text;
};

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
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', {text: 'Cloudflare 图片上传器设置'});

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

        containerEl.createEl('h3', {text: 'Cloudflare R2 Worker 配置'});

        new Setting(containerEl)
            .setName('Worker URL')
            .setDesc('您部署的 Cloudflare R2 Worker 的 URL')
            .addText(text => text
                .setPlaceholder('https://your-worker.your-subdomain.workers.dev')
                .setValue(this.plugin.settings.workerSettings.workerUrl)
                .onChange(async (value) => {
                    // 正则表达式验证 URL 格式
                    const urlRegex = /^https:\/\/[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&\/=]*$/;
                    
                    // 去除首尾空格
                    const trimmedValue = value.trim();

                    // 如果为空，提示必填
                    if (!trimmedValue) {
                        new Notice('Worker URL 不能为空');
                        text.setValue(this.plugin.settings.workerSettings.workerUrl);
                        return;
                    }

                    // 验证修改后的 URL 是否符合格式
                    if (urlRegex.test(trimmedValue)) {
                        this.plugin.settings.workerSettings.workerUrl = trimmedValue;
                        await this.plugin.saveSettings();
                    } else {
                        // URL 格式无效，显示提示或者还原为上一个有效值
                        new Notice('请输入有效的 Worker URL 地址，例如: https://your-worker.your-subdomain.workers.dev');
                        // 可选：重置为上一个有效值
                        text.setValue(this.plugin.settings.workerSettings.workerUrl);
                    }
                })
            );

        new Setting(containerEl)
            .setName('API Key')
            .setDesc('Worker 认证所需的 API Key')
            .addText((text) => {
                wrapTextWithPasswordHide(text);
                text.setPlaceholder('输入您的 API Key')
                    .setValue(this.plugin.settings.workerSettings.apiKey)
                    .onChange(async (value) => {
                        // API Key 正则验证 - 通常应为字母、数字和部分特殊字符组成
                        const apiKeyRegex = /^[a-zA-Z0-9_\-]+$/;
                        
                        // 去除首尾空格
                        const trimmedValue = value.trim();

                        // 如果为空，提示必填
                        if (!trimmedValue) {
                            new Notice('API Key 不能为空');
                            text.setValue(this.plugin.settings.workerSettings.apiKey);
                            return;
                        }
                        
                        // 验证 API Key 格式
                        if (apiKeyRegex.test(trimmedValue)) {
                            this.plugin.settings.workerSettings.apiKey = trimmedValue;
                            await this.plugin.saveSettings();
                        } else {
                            // 验证失败，显示提示
                            new Notice('请输入有效的 API Key，仅包含字母、数字、下划线和短横线');
                            // 可选：重置为上一个有效值
                            text.setValue(this.plugin.settings.workerSettings.apiKey);
                        }
                    });
            });

        new Setting(containerEl)
            .setName('存储桶名称')
            .setDesc('上传文件的目标存储桶')
            .addText(text => text
                .setPlaceholder('输入您的存储桶名称')
                .setValue(this.plugin.settings.workerSettings.bucketName)
                .onChange(async (value) => {
                    // 存储桶名称的正则验证，只允许字母、数字、连字符和点
                    const bucketNameRegex = /^[a-z0-9][a-z0-9\-.]{2,61}[a-z0-9]$/;
                    
                    // 移除首尾空格
                    const trimmedValue = value.trim();
                    
                    // 如果为空，提示必填
                    if (!trimmedValue) {
                        new Notice('存储桶名称不能为空');
                        text.setValue(this.plugin.settings.workerSettings.bucketName);
                        return;
                    }
                    
                    // 验证存储桶名称格式
                    if (bucketNameRegex.test(trimmedValue)) {
                        this.plugin.settings.workerSettings.bucketName = trimmedValue;
                        await this.plugin.saveSettings();
                    } else {
                        new Notice('存储桶名称格式无效，只能包含小写字母、数字、连字符和点，长度在 3-63 个字符之间，且不能以连字符或点开头或结尾');
                        text.setValue(this.plugin.settings.workerSettings.bucketName);
                    }
                })
            );

        new Setting(containerEl)
            .setName('文件夹名称（可选）')
            .setDesc('上传文件的目标文件夹，如不填则默认存储到存储桶的一级目录下')
            .addText(text => text
                .setPlaceholder('请输入上传的文件夹名称')
                .setValue(this.plugin.settings.workerSettings.folderName || '')
                .onChange(async (value) => {
                    // 移除首尾空格
                    const trimmedValue = value.trim();
                    
                    // 如果为空，允许空值
                    if (!trimmedValue) {
                        this.plugin.settings.workerSettings.folderName = undefined;
                        await this.plugin.saveSettings();
                        return;
                    }
                    
                    // 文件夹名称正则验证，允许字母、数字、连字符、下划线和斜杠
                    const folderNameRegex = /^[a-zA-Z0-9_\-\/]+$/;
                    
                    // 验证文件夹名称格式
                    if (folderNameRegex.test(trimmedValue)) {
                        this.plugin.settings.workerSettings.folderName = trimmedValue;
                        await this.plugin.saveSettings();
                    } else {
                        new Notice('文件夹名称格式无效，只能包含字母、数字、下划线、连字符和斜杠');
                        text.setValue(this.plugin.settings.workerSettings.folderName || '');
                    }
                })
            );

        new Setting(containerEl)
            .setName('R2 Bucket 自定义域名（可选）')
            .setDesc('您为 R2 Bucket 配置的自定义域名，将替代默认的 Cloudflare 域名')
            .addText(text => text
                .setPlaceholder('https://images.yourdomain.com')
                .setValue(this.plugin.settings.workerSettings.customDomain || '')
                .onChange(async (value) => {
                    // 移除首尾空格
                    const trimmedValue = value.trim();
                    
                    // 如果为空，允许空值
                    if (!trimmedValue) {
                        this.plugin.settings.workerSettings.customDomain = '';
                        await this.plugin.saveSettings();
                        return;
                    }
                    
                    // 确保 URL 以 https:// 开头
                    let formattedValue = trimmedValue;
                    if (!formattedValue.startsWith('https://')) {
                        formattedValue = 'https://' + formattedValue;
                    }
                    
                    // 域名格式正则验证
                    const domainRegex = /^https:\/\/(?:[-a-zA-Z0-9@:%._+~#=]{1,256}\.)+[a-zA-Z0-9()]{1,6}\b[-a-zA-Z0-9()@:%_+.~#?&\/=]*$/;
                    
                    // 验证域名格式
                    if (domainRegex.test(formattedValue)) {
                        this.plugin.settings.workerSettings.customDomain = formattedValue;
                        await this.plugin.saveSettings();
                    } else {
                        new Notice('自定义域名格式无效，请输入正确的域名格式，例如：https://images.yourdomain.com');
                        text.setValue(this.plugin.settings.workerSettings.customDomain || '');
                    }
                })
            );
    }
} 