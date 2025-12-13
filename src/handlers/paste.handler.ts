/**
 * PasteHandler - Handles paste events for automatic image upload
 *
 * Responsibilities:
 * - Register/unregister paste event listeners
 * - Intercept image paste events
 * - Upload pasted images directly to storage provider
 * - Insert markdown link into editor
 */

import {App, Editor, EditorPosition, EventRef, MarkdownView, Notice, Plugin} from 'obsidian';
import {v4 as uuidv4} from 'uuid';
import {StorageProvider} from '../types';
import {Logger} from '../utils';
import {MIME_TYPES} from '../config';

/**
 * Reverse mapping from MIME type to extension
 */
const MIME_TO_EXT: Record<string, string> = Object.entries(MIME_TYPES).reduce(
    (acc, [ext, mime]) => {
        // Only add if not already present (prefer first mapping)
        if (!acc[mime]) {
            acc[mime] = `.${ext}`;
        }
        return acc;
    },
    {} as Record<string, string>
);

export class PasteHandler {
    private readonly logger: Logger;
    private eventRefs: EventRef[] = [];

    constructor(
        private readonly app: App,
        private readonly getStorageProvider: () => StorageProvider,
        private readonly plugin: Plugin
    ) {
        this.logger = Logger.getInstance();
        // Bind method to instance for event handler
        this.handlePasteEvent = this.handlePasteEvent.bind(this);
    }

    /**
     * Register paste event handler
     */
    public register(): void {
        // Clean up old event refs first
        this.unregister();

        try {
            // Use type assertion to work around Obsidian's typing
            const handler = this.handlePasteEvent as unknown as (...args: any[]) => any;
            const eventName = 'editor-paste' as any;

            const eventRef = this.app.workspace.on(eventName, handler);

            // Register with plugin for automatic cleanup on unload
            this.plugin.registerEvent(eventRef);

            // Store ref for manual cleanup
            this.eventRefs.push(eventRef);

            this.logger.info('已注册粘贴事件处理');
        } catch (error) {
            this.logger.error('注册粘贴事件失败', error);
        }
    }

    /**
     * Unregister paste event handler
     */
    public unregister(): void {
        for (const ref of this.eventRefs) {
            if (ref) {
                this.app.workspace.offref(ref);
            }
        }
        this.eventRefs = [];
        this.logger.info('已取消注册粘贴事件');
    }

    /**
     * Handle paste event
     */
    private async handlePasteEvent(
        evt: ClipboardEvent,
        editor: Editor,
        _view: MarkdownView
    ): Promise<void> {
        if (!evt.clipboardData?.items) {
            return;
        }

        const images = this.extractImages(evt.clipboardData.items);

        if (images.length === 0) {
            return;
        }

        // Prevent default paste handling
        evt.preventDefault();
        evt.stopPropagation();

        // Process each image
        for (const {file, mimeType} of images) {
            await this.uploadImage(file, editor, mimeType);
        }
    }

    /**
     * Extract image files from clipboard items
     */
    private extractImages(items: DataTransferItemList): Array<{file: File; mimeType: string}> {
        const images: Array<{file: File; mimeType: string}> = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];

            if (!item.type.startsWith('image/')) {
                continue;
            }

            const file = item.getAsFile();
            if (file) {
                images.push({file, mimeType: item.type});
            }
        }

        return images;
    }

    /**
     * Upload a single image and insert link into editor
     */
    private async uploadImage(file: File, editor: Editor, mimeType: string): Promise<void> {
        const ext = this.getExtensionFromMime(mimeType);
        const filename = `pasted-image-${uuidv4()}${ext}`;

        this.logger.info('开始上传粘贴的图片...');
        new Notice('正在上传图片...', 2000);

        // Insert placeholder and record its position
        const placeholder = `![上传中...](${filename})`;
        const startPos = editor.getCursor();
        editor.replaceSelection(placeholder);
        // Calculate end position (same line, column offset by placeholder length)
        const endPos: EditorPosition = {
            line: startPos.line,
            ch: startPos.ch + placeholder.length
        };

        try {
            const arrayBuffer = await file.arrayBuffer();
            const storageProvider = this.getStorageProvider();

            const result = await storageProvider.uploadImage(
                arrayBuffer,
                filename,
                undefined,
                {timeout: 30000}
            );

            // Replace placeholder with actual link using targeted replacement
            const altText = file.name || '图片';
            const markdownLink = `![${altText}](${result.url})`;

            this.replaceRange(editor, placeholder, markdownLink, startPos, endPos);

            this.logger.info(`粘贴图片上传成功: ${filename}`);
            new Notice('图片上传成功!', 2000);

        } catch (error: any) {
            // Remove placeholder on failure using targeted replacement
            this.replaceRange(editor, placeholder, '', startPos, endPos);

            const errorMessage = error.message || '未知错误';
            this.logger.error(`粘贴图片上传失败: ${filename}`, error);
            new Notice(`图片上传失败: ${errorMessage}`, 5000);
        }
    }

    /**
     * Replace text in editor using targeted range replacement.
     *
     * This avoids overwriting concurrent user edits by:
     * 1. Finding the placeholder within the expected range
     * 2. Using replaceRange() for surgical replacement
     * 3. Falling back to full content search only if range doesn't match
     */
    private replaceRange(
        editor: Editor,
        oldText: string,
        newText: string,
        expectedStart: EditorPosition,
        expectedEnd: EditorPosition
    ): void {
        // Try to get text at expected range
        const textAtRange = editor.getRange(expectedStart, expectedEnd);

        if (textAtRange === oldText) {
            // Placeholder is exactly where we expect - use targeted replacement
            editor.replaceRange(newText, expectedStart, expectedEnd);
        } else {
            // Placeholder may have shifted due to user edits before it
            // Search for it in the document and replace
            const content = editor.getValue();
            const index = content.indexOf(oldText);

            if (index !== -1) {
                // Convert linear index to line/ch position
                const beforeText = content.substring(0, index);
                const lines = beforeText.split('\n');
                const startLine = lines.length - 1;
                const startCh = lines[startLine].length;
                const start: EditorPosition = {line: startLine, ch: startCh};
                const end: EditorPosition = {line: startLine, ch: startCh + oldText.length};

                editor.replaceRange(newText, start, end);
            }
            // If not found, placeholder was likely deleted by user - do nothing
        }
    }

    /**
     * Get file extension from MIME type
     */
    private getExtensionFromMime(mimeType: string): string {
        return MIME_TO_EXT[mimeType] || '.png';
    }
}
