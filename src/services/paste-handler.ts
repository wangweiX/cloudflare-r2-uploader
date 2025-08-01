import {App, Editor, EventRef, MarkdownView, Notice, Plugin} from 'obsidian';
import {v4 as uuidv4} from 'uuid';
import {StorageProvider} from '../models/storage-provider';
import {Logger} from '../utils/logger';

/**
 * 粘贴事件处理服务 - 负责处理图片粘贴并上传
 */
export class PasteHandler {
    private logger: Logger;
    private eventRefs: EventRef[] = [];

    /**
     * 构造函数
     */
    constructor(
        private app: App,
        private storageProvider: StorageProvider,
        private plugin: Plugin
    ) {
        this.logger = Logger.getInstance();
        // 绑定方法到实例
        this.handlePasteEvent = this.handlePasteEvent.bind(this);
    }

    /**
     * 注册粘贴事件处理
     */
    public registerPasteEvent(): void {
        // 清理旧的事件引用
        this.unregisterPasteEvent();

        try {
            // 使用类型断言解决类型问题
            const handler = this.handlePasteEvent as unknown as (...args: any[]) => any;
            const eventName = 'editor-paste' as any;

            // 获取事件引用
            const eventRef = this.app.workspace.on(eventName, handler);

            // 向插件注册这个事件，以便在插件禁用时自动清理
            this.plugin.registerEvent(eventRef);

            // 存储事件引用用于手动清理
            this.eventRefs.push(eventRef);

            this.logger.info('已注册粘贴事件处理');
        } catch (error) {
            this.logger.error('注册粘贴事件失败', error);
        }
    }

    /**
     * 取消注册粘贴事件
     */
    public unregisterPasteEvent(): void {
        // 遍历并清理每个事件引用
        this.eventRefs.forEach(ref => {
            if (ref) {
                // 使用Obsidian的workspace.offref方法取消注册
                this.app.workspace.offref(ref);
            }
        });
        this.eventRefs = [];
        this.logger.info('已取消注册粘贴事件');
    }

    /**
     * 处理粘贴事件
     */
    private async handlePasteEvent(evt: ClipboardEvent, editor: Editor, view: MarkdownView): Promise<void> {
        // 检查是否包含图片
        if (!evt.clipboardData || !evt.clipboardData.items) {
            return;
        }

        const items = evt.clipboardData.items;
        const imagesToProcess: Array<{ file: File, type: string }> = [];

        // 先检查是否有图片
        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            // 只处理图片类型
            if (!item.type.startsWith('image/')) {
                continue;
            }

            const file = item.getAsFile();
            if (file) {
                imagesToProcess.push({file, type: item.type});
            }
        }

        // 如果有图片，立即阻止默认事件处理
        if (imagesToProcess.length > 0) {
            evt.preventDefault();
            evt.stopPropagation();

            // 异步处理图片上传
            for (const {file, type} of imagesToProcess) {
                await this.processImageUpload(file, editor, type);
            }
        }
    }

    /**
     * 处理图片上传
     */
    private async processImageUpload(file: File, editor: Editor, mimeType: string): Promise<void> {
        try {
            // 显示上传中提示
            this.logger.info('开始上传粘贴的图片...');
            new Notice('正在上传图片...', 2000);

            // 生成临时文件名
            const ext = this.getExtensionFromMime(mimeType);
            const filename = `pasted-image-${uuidv4()}${ext}`;

            // 读取文件内容
            const arrayBuffer = await file.arrayBuffer();

            // 先插入临时占位符
            const placeholder = `![上传中...](${filename})`;
            const cursor = editor.getCursor();
            editor.replaceSelection(placeholder);

            // 使用新的uploadImage方法上传
            try {
                const result = await this.storageProvider.uploadImage(
                    arrayBuffer,
                    filename,
                    undefined,
                    {timeout: 30000}
                );

                // 上传成功，替换占位符为云端链接
                const markdownText = `![${file.name || '图片'}](${result.url})`;

                // 查找并替换占位符
                const content = editor.getValue();
                const newContent = content.replace(placeholder, markdownText);
                editor.setValue(newContent);

                // 恢复光标位置
                editor.setCursor(cursor);

                this.logger.info(`粘贴图片上传成功: ${filename}`);
                new Notice('图片上传成功!', 2000);
            } catch (error: any) {
                // 上传失败，移除占位符
                const content = editor.getValue();
                const newContent = content.replace(placeholder, '');
                editor.setValue(newContent);
                editor.setCursor(cursor);

                const errorMessage = error.message || '未知错误';
                this.logger.error(`粘贴图片上传失败: ${filename}`, error);
                new Notice(`图片上传失败: ${errorMessage}`, 5000);
            }
        } catch (error) {
            this.logger.error('处理粘贴图片时出错', error);
            new Notice('处理粘贴图片时出错', 5000);
        }
    }

    /**
     * 根据MIME类型获取文件扩展名
     */
    private getExtensionFromMime(mimeType: string): string {
        const mimeToExt: { [key: string]: string } = {
            'image/png': '.png',
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'image/svg+xml': '.svg',
            'image/bmp': '.bmp',
            'image/x-icon': '.ico',
            'image/tiff': '.tiff'
        };
        return mimeToExt[mimeType] || '.png';
    }
}