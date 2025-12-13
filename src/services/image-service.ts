import {App} from 'obsidian';
import {Logger, resolveAbsolutePath} from '../utils';
import {IMAGE_PATTERNS} from '../config';

/**
 * 图片服务 - 负责查找需要上传的图片
 */
export class ImageService {
    private logger: Logger;

    /**
     * 构造函数
     */
    constructor(
        private app: App,
        private storageProvider: any // 保留以保持向后兼容
    ) {
        this.logger = Logger.getInstance();
    }

    /**
     * 查找所有笔记中需要上传的图片
     */
    public async findImagesToUpload(): Promise<Set<string>> {
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const imagePathsToUpload = new Set<string>();

        for (const file of markdownFiles) {
            const content = await this.app.vault.cachedRead(file);
            
            // 查找标准Markdown格式的图片链接 ![alt](path)
            const standardRegex = IMAGE_PATTERNS.STANDARD_MARKDOWN;
            let match;
            while ((match = standardRegex.exec(content)) !== null) {
                const imagePath = match[2];
                // 跳过网络图片
                if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                    continue;
                }
                
                const absolutePath = await resolveAbsolutePath(file.path, imagePath, this.app.vault.adapter);
                if (absolutePath && await this.app.vault.adapter.exists(absolutePath)) {
                    imagePathsToUpload.add(absolutePath);
                }
            }

            // 查找Obsidian内部链接格式的图片 ![[path]]
            const obsidianRegex = IMAGE_PATTERNS.OBSIDIAN_INTERNAL;
            while ((match = obsidianRegex.exec(content)) !== null) {
                const imagePath = match[1];
                const absolutePath = await resolveAbsolutePath(file.path, imagePath, this.app.vault.adapter);
                if (absolutePath && await this.app.vault.adapter.exists(absolutePath)) {
                    imagePathsToUpload.add(absolutePath);
                }
            }
        }

        this.logger.info(`找到 ${imagePathsToUpload.size} 张图片需要上传`);
        return imagePathsToUpload;
    }

}
