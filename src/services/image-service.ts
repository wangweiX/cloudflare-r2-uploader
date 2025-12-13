import {App} from 'obsidian';
import {ImageFinder} from '../image';
import {Logger} from '../utils';

/**
 * ImageService - Thin wrapper around ImageFinder for backwards compatibility
 *
 * This class will be deprecated once main.ts is refactored to use ImageFinder directly.
 */
export class ImageService {
    private readonly logger: Logger;
    private readonly finder: ImageFinder;

    constructor(
        private readonly app: App,
        _storageProvider: any // Kept for backwards compatibility, no longer used
    ) {
        this.logger = Logger.getInstance();
        this.finder = new ImageFinder(app, app.vault.adapter);
    }

    /**
     * Find all images in the vault that need to be uploaded
     *
     * @deprecated Use ImageFinder.findInVault() directly
     */
    public async findImagesToUpload(): Promise<Set<string>> {
        const imagePaths = await this.finder.findInVault();
        this.logger.info(`找到 ${imagePaths.size} 张图片需要上传`);
        return imagePaths;
    }
}
