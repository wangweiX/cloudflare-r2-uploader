import {PluginSettings, StorageProviderType} from '../types';
import {BaseStorageProvider, ErrorClassifier, ExecuteUploadResult, isCommonNetworkError, ProviderUploadSettings} from './base.provider';

/**
 * Cloudflare Worker provider - handles uploads via Cloudflare Worker proxy.
 *
 * Only implements the provider-specific abstract methods.
 * The upload algorithm is defined in BaseStorageProvider.uploadImage().
 */
export class CloudflareWorkerService extends BaseStorageProvider {
    private static readonly ERROR_CLASSIFIER: ErrorClassifier = {
        isAuthError: (_, msg) => msg.includes('配置不完整'),
        isNetworkError: (err, msg) =>
            isCommonNetworkError(err) ||
            msg.includes('Failed to fetch') ||
            msg.includes('网络'),
        isServerError: (err) => err.status && err.status >= 500,
        getErrorCode: (err) => err.code || err.status
    };

    constructor(private settings: PluginSettings) {
        super();
    }

    public getType(): StorageProviderType {
        return StorageProviderType.CLOUDFLARE_WORKER;
    }

    protected validateSettings(): void {
        const {workerUrl, apiKey, bucketName} = this.settings.workerSettings;
        if (!workerUrl || !apiKey || !bucketName) {
            throw new Error('Worker 配置不完整：缺少 Worker URL、API Key 或 Bucket 名称');
        }
    }

    protected getUploadSettings(): ProviderUploadSettings {
        return {
            folderName: this.settings.workerSettings.folderName,
            customDomain: this.settings.workerSettings.customDomain
        };
    }

    /**
     * Returns the fallback base URL for Worker uploads.
     *
     * Preserves the full URL path (not just origin) to support Workers
     * deployed with path prefixes, e.g., "https://cdn.example.com/images".
     */
    protected getFallbackBaseUrl(): string {
        // Preserve full URL, just normalize trailing slashes
        return this.settings.workerSettings.workerUrl.replace(/\/+$/, '');
    }

    protected getErrorClassifier(): ErrorClassifier {
        return CloudflareWorkerService.ERROR_CLASSIFIER;
    }

    protected async executeUpload(
        fileContent: ArrayBuffer,
        filePath: string,
        mimeType: string,
        signal: AbortSignal
    ): Promise<ExecuteUploadResult> {
        const {workerUrl, apiKey, bucketName} = this.settings.workerSettings;

        const encodedPath = filePath.split('/').map(encodeURIComponent).join('/');
        const uploadUrl = `${workerUrl}/api/v1/buckets/${bucketName}/files/${encodedPath}`;
        this.logger.info(`上传URL: ${uploadUrl}`);

        // Note: Content-Length is automatically set by fetch; explicitly setting it
        // may cause issues in some environments (forbidden header in browsers)
        const response = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': mimeType
            },
            body: fileContent,
            signal
        });

        const json = await response.json();
        if (!response.ok || !json.success) {
            this.logger.error(`上传失败响应: ${response.status} ${response.statusText}`, json);
            throw new Error(json.error || response.statusText || '未知错误');
        }

        return {etag: json.etag};
    }
}
