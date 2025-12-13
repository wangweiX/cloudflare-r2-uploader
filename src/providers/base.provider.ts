import {StorageProvider, StorageProviderType, UploadError, UploadOptions, UploadResult} from '../types';
import {Logger, generateUniqueFileName, getMimeType} from '../utils';

/**
 * Common Node/Electron network error codes for better error classification
 */
const NETWORK_ERROR_CODES = new Set([
    'ECONNRESET',      // Connection reset by peer
    'ENOTFOUND',       // DNS lookup failed
    'EAI_AGAIN',       // DNS lookup timed out
    'ETIMEDOUT',       // Connection timed out
    'ECONNREFUSED',    // Connection refused
    'EHOSTUNREACH',    // Host unreachable
    'ENETUNREACH',     // Network unreachable
    'EPIPE',           // Broken pipe
    'ECONNABORTED',    // Connection aborted
]);

/**
 * Error classifier interface - each provider implements its own classification rules
 */
export interface ErrorClassifier {
    isAuthError(error: any, message: string): boolean;
    isNetworkError(error: any, message: string): boolean;
    isServerError(error: any): boolean;
    getErrorCode(error: any): string | number | undefined;
}

/**
 * Check if an error is a common network error based on error codes
 */
export function isCommonNetworkError(error: any): boolean {
    const code = error?.code || error?.cause?.code;
    return code ? NETWORK_ERROR_CODES.has(code) : false;
}

/**
 * Upload preparation result
 */
export interface UploadPreparation {
    uniqueFileName: string;
    filePath: string;
    mimeType: string;
}

/**
 * Provider-specific upload settings
 */
export interface ProviderUploadSettings {
    folderName?: string;
    customDomain?: string;
}

/**
 * Result from provider-specific upload execution
 */
export interface ExecuteUploadResult {
    etag?: string;
}

/**
 * Timeout controller wrapper
 */
interface TimeoutController {
    signal: AbortSignal;
    clear: () => void;
}

/**
 * Base storage provider using Template Method pattern.
 *
 * The uploadImage() method defines the algorithm skeleton:
 * 1. Validate settings
 * 2. Prepare upload (unique filename, path, mime type)
 * 3. Create timeout controller
 * 4. Report initial progress
 * 5. Execute upload (provider-specific)
 * 6. Build public URL
 * 7. Report final progress
 * 8. Return result
 *
 * Subclasses implement only the provider-specific abstract methods.
 */
export abstract class BaseStorageProvider implements StorageProvider {
    protected readonly logger: Logger;

    constructor() {
        this.logger = Logger.getInstance();
    }

    // ===== Abstract methods - must be implemented by subclasses =====

    /** Returns the storage provider type identifier */
    public abstract getType(): StorageProviderType;

    /** Validates provider-specific settings, throws if invalid */
    protected abstract validateSettings(): void;

    /** Returns folder name and custom domain from provider settings */
    protected abstract getUploadSettings(): ProviderUploadSettings;

    /** Returns the fallback base URL when custom domain is not set */
    protected abstract getFallbackBaseUrl(): string;

    /** Returns the error classifier for this provider */
    protected abstract getErrorClassifier(): ErrorClassifier;

    /** Executes the actual upload - S3 client, fetch, etc. */
    protected abstract executeUpload(
        fileContent: ArrayBuffer,
        filePath: string,
        mimeType: string,
        signal: AbortSignal
    ): Promise<ExecuteUploadResult>;

    // ===== Template Method - defines the upload algorithm =====

    /**
     * Template method that defines the upload algorithm skeleton.
     * Subclasses customize behavior by implementing abstract methods.
     */
    public async uploadImage(
        fileContent: ArrayBuffer,
        fileName: string,
        onProgress?: (progress: number) => void,
        options?: UploadOptions
    ): Promise<UploadResult> {
        // Step 1: Validate provider-specific settings
        this.validateSettings();

        // Step 2: Get upload settings and prepare
        const {folderName, customDomain} = this.getUploadSettings();
        const {filePath, mimeType} = this.prepareUpload(fileName, folderName);

        // Step 3: Create timeout controller
        const timeout = this.createTimeoutController(options?.timeout);

        try {
            // Step 4: Report initial progress
            this.reportProgress(onProgress, 0.1);

            // Step 5: Execute provider-specific upload
            const result = await this.executeUpload(fileContent, filePath, mimeType, timeout.signal);

            // Step 6: Clear timeout and report progress
            timeout.clear();
            this.reportProgress(onProgress, 0.9);

            // Step 7: Build public URL
            const imageUrl = this.buildPublicUrl(customDomain, filePath, this.getFallbackBaseUrl());

            // Step 8: Report final progress and log
            this.reportProgress(onProgress, 1);
            this.logger.info(`文件上传成功: ${fileName} -> ${imageUrl}`);

            // Step 9: Return result
            return {url: imageUrl, etag: result.etag};
        } catch (error: any) {
            timeout.clear();
            this.checkAbortError(error);
            this.normalizeAndThrowError(error, fileName, this.getErrorClassifier());
        }
    }

    // ===== Protected utility methods =====

    protected prepareUpload(fileName: string, folderName?: string): UploadPreparation {
        const uniqueFileName = generateUniqueFileName(fileName);
        const filePath = this.buildFilePath(folderName, uniqueFileName);
        const mimeType = getMimeType(fileName);
        this.logger.info(`上传文件: ${fileName} -> ${filePath}, 类型: ${mimeType}`);
        return {uniqueFileName, filePath, mimeType};
    }

    protected buildFilePath(folderName: string | undefined, fileName: string): string {
        const folder = this.sanitizeFolderName(folderName);
        return folder ? `${folder}/${fileName}` : fileName;
    }

    protected sanitizeFolderName(folderName?: string): string {
        if (!folderName) return '';
        return folderName
            .replace(/\\/g, '/')
            .trim()
            .replace(/^\/+|\/+$/g, '')
            .replace(/\/{2,}/g, '/');
    }

    /**
     * Build the public URL for an uploaded file.
     *
     * Handles edge cases:
     * - Normalizes trailing slashes to avoid double slashes
     * - Supports customDomain with or without protocol
     * - Supports customDomain with path prefix (e.g., "cdn.example.com/images")
     * - fallbackBase may include bucket path (e.g., R2: "https://account.r2.../bucket")
     */
    protected buildPublicUrl(customDomain: string | undefined, filePath: string, fallbackBase: string): string {
        let base: string;

        if (customDomain?.trim()) {
            const domain = customDomain.trim();
            // Add protocol if missing
            const fullUrl = domain.startsWith('http') ? domain : `https://${domain}`;
            // Normalize: remove trailing slashes
            base = fullUrl.replace(/\/+$/, '');
        } else {
            // Normalize fallback: remove trailing slashes
            base = fallbackBase.replace(/\/+$/, '');
        }

        return `${base}/${filePath}`;
    }

    protected createTimeoutController(timeout?: number): TimeoutController {
        const controller = new AbortController();
        const timeoutId = timeout
            ? setTimeout(() => controller.abort(), timeout)
            : null;
        return {
            signal: controller.signal,
            clear: () => {
                if (timeoutId) clearTimeout(timeoutId);
            }
        };
    }

    protected reportProgress(onProgress?: (progress: number) => void, value: number = 0): void {
        onProgress?.(value);
    }

    // ===== Error handling =====

    protected checkAbortError(error: any): void {
        if (error.name === 'AbortError') {
            throw this.createError('timeout', '上传超时', 'TIMEOUT');
        }
    }

    protected createError(
        type: UploadError['type'],
        message: string,
        code?: string | number
    ): UploadError {
        return {type, message, code};
    }

    protected normalizeAndThrowError(
        error: any,
        fileName: string,
        classifier: ErrorClassifier
    ): never {
        this.logger.error(`上传文件失败 ${fileName}:`, error);

        // Already normalized
        if (error.type) {
            throw error;
        }

        const message = error.message || String(error);
        let type: UploadError['type'] = 'unknown';

        if (classifier.isAuthError(error, message)) {
            type = 'auth';
        } else if (classifier.isNetworkError(error, message)) {
            type = 'network';
        } else if (classifier.isServerError(error)) {
            type = 'server';
        }

        throw this.createError(type, message, classifier.getErrorCode(error));
    }
}
