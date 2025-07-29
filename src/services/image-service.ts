import {App} from 'obsidian';
import * as path from 'path';
import {Logger} from '../utils/logger';

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
            const standardRegex = /!\[([^\]]*)\]\(([^)]*)\)/g;
            let match;
            while ((match = standardRegex.exec(content)) !== null) {
                const imagePath = match[2];
                // 跳过网络图片
                if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
                    continue;
                }
                
                const absolutePath = await this.resolveAbsolutePath(file.path, imagePath);
                if (absolutePath && await this.app.vault.adapter.exists(absolutePath)) {
                    imagePathsToUpload.add(absolutePath);
                }
            }

            // 查找Obsidian内部链接格式的图片 ![[path]]
            const obsidianRegex = /!\[\[([^\]]+)\]\]/g;
            while ((match = obsidianRegex.exec(content)) !== null) {
                const imagePath = match[1];
                const absolutePath = await this.resolveAbsolutePath(file.path, imagePath);
                if (absolutePath && await this.app.vault.adapter.exists(absolutePath)) {
                    imagePathsToUpload.add(absolutePath);
                }
            }
        }

        this.logger.info(`找到 ${imagePathsToUpload.size} 张图片需要上传`);
        return imagePathsToUpload;
    }

    /**
     * 解析图片的绝对路径
     */
    private async resolveAbsolutePath(notePath: string, imagePath: string): Promise<string | null> {
        // 如果已经是绝对路径，直接返回
        if (path.isAbsolute(imagePath)) {
            return imagePath;
        }

        // 尝试从笔记所在目录解析
        const noteDir = path.dirname(notePath);
        let absolutePath = path.normalize(path.join(noteDir, imagePath));
        
        if (await this.app.vault.adapter.exists(absolutePath)) {
            return absolutePath;
        }

        // 尝试从vault根目录解析
        absolutePath = path.normalize(imagePath);
        if (await this.app.vault.adapter.exists(absolutePath)) {
            return absolutePath;
        }

        return null;
    }
}