import {App, TFile} from 'obsidian';
import {StorageProvider, UploadError, UploadResult, UploadTask} from '../types';
import {Logger} from '../utils';

/**
 * Progress callback with computed metrics
 */
export interface ProgressInfo {
    progress: number;      // 0-1
    uploadedSize: number;  // bytes
    speed?: number;        // bytes per second
}

/**
 * Task execution options
 */
export interface TaskExecutionOptions {
    timeout?: number;
    signal?: AbortSignal;
}

/**
 * Task execution result
 */
export interface TaskExecutionResult {
    success: boolean;
    url?: string;
    etag?: string;
    error?: UploadError;
}

/**
 * File reader interface - abstracts Obsidian's Vault API
 */
export interface IFileReader {
    /**
     * Check if file exists and return file info
     */
    getFile(filePath: string): TFile | null;

    /**
     * Read file content as ArrayBuffer
     */
    readBinary(file: TFile): Promise<ArrayBuffer>;
}

/**
 * Default file reader using Obsidian's Vault API
 */
export class VaultFileReader implements IFileReader {
    constructor(private readonly app: App) {}

    public getFile(filePath: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        return file instanceof TFile ? file : null;
    }

    public async readBinary(file: TFile): Promise<ArrayBuffer> {
        return this.app.vault.readBinary(file);
    }
}

/**
 * TaskRunner - Executes a single upload task.
 *
 * Responsibilities:
 * - Read file content via IFileReader
 * - Call StorageProvider.uploadImage
 * - Track progress and compute metrics (speed, uploadedSize)
 * - Return success/failure result
 *
 * Does NOT handle:
 * - Retry logic (handled by UploadManager + RetryStrategy)
 * - Queue management (handled by UploadManager)
 * - Event emission (handled by UploadManager)
 */
export class TaskRunner {
    private readonly logger: Logger;

    constructor(
        private readonly fileReader: IFileReader,
        private readonly storageProvider: StorageProvider
    ) {
        this.logger = Logger.getInstance();
    }

    /**
     * Execute a single upload task
     *
     * @param task The task to execute (will be mutated with progress info)
     * @param options Execution options (timeout, abort signal)
     * @param onProgress Optional callback for progress updates
     */
    public async execute(
        task: UploadTask,
        options?: TaskExecutionOptions,
        onProgress?: (info: ProgressInfo) => void
    ): Promise<TaskExecutionResult> {
        try {
            // Check if already aborted
            if (options?.signal?.aborted) {
                return this.createErrorResult('unknown', '任务已取消');
            }

            // Step 1: Get file
            const file = this.fileReader.getFile(task.filePath);
            if (!file) {
                return this.createErrorResult('unknown', `文件不存在: ${task.filePath}`);
            }

            // Step 2: Read file content
            const arrayBuffer = await this.fileReader.readBinary(file);

            // Check abort after file read
            if (options?.signal?.aborted) {
                return this.createErrorResult('unknown', '任务已取消');
            }

            // Step 3: Create progress tracker
            const startTime = Date.now();
            const progressCallback = (progress: number) => {
                const uploadedSize = Math.floor(task.fileSize * progress);
                const elapsedSeconds = (Date.now() - startTime) / 1000;
                const speed = elapsedSeconds > 0 ? uploadedSize / elapsedSeconds : undefined;

                onProgress?.({progress, uploadedSize, speed});
            };

            // Step 4: Execute upload (timeout + cancellation signal)
            const result = await this.storageProvider.uploadImage(
                arrayBuffer,
                task.fileName,
                progressCallback,
                options?.timeout || options?.signal
                    ? {timeout: options.timeout, signal: options.signal}
                    : undefined
            );

            // Step 5: Return success
            this.logger.info(`上传成功: ${task.fileName} -> ${result.url}`);
            return {
                success: true,
                url: result.url,
                etag: result.etag
            };

        } catch (error: any) {
            return this.handleError(error, task.fileName);
        }
    }

    /**
     * Handle and normalize errors
     */
    private handleError(error: any, fileName: string): TaskExecutionResult {
        this.logger.error(`上传失败: ${fileName}`, error);

        // Already normalized error from provider
        if (error.type) {
            return {
                success: false,
                error: error as UploadError
            };
        }

        // Normalize unknown error
        const normalizedError = this.normalizeError(error);
        return {
            success: false,
            error: normalizedError
        };
    }

    /**
     * Normalize error to UploadError format
     */
    private normalizeError(error: any): UploadError {
        const message = error.message || String(error);
        let type: UploadError['type'] = 'unknown';

        // Classify error type based on message/properties
        if (message.includes('timeout') || message.includes('超时')) {
            type = 'timeout';
        } else if (message.includes('network') || message.includes('网络') || message.includes('Failed to fetch')) {
            type = 'network';
        } else if (error.code === 'AUTH_ERROR' || message.includes('认证') || message.includes('授权')) {
            type = 'auth';
        } else if (error.code === 'SERVER_ERROR' || (error.status && error.status >= 500)) {
            type = 'server';
        }

        return {
            type,
            message,
            code: error.code || error.status,
            details: error
        };
    }

    /**
     * Create error result helper
     */
    private createErrorResult(type: UploadError['type'], message: string): TaskExecutionResult {
        return {
            success: false,
            error: {type, message}
        };
    }
}
