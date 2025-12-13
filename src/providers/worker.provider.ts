import {StorageProviderType, WorkerProviderSettings} from '../types';
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

    constructor(private settings: WorkerProviderSettings) {
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

        // Parse response with proper error handling for non-JSON responses
        let json: { success?: boolean; error?: string; etag?: string };
        try {
            const contentType = response.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                // Non-JSON response (e.g., HTML error page from proxy/CDN)
                const text = await response.text();
                this.logger.error(`非JSON响应 (${contentType}): ${text.substring(0, 200)}`);
                throw new Error(
                    !response.ok
                        ? `HTTP ${response.status}: ${response.statusText}`
                        : `服务器返回了非JSON响应: ${contentType || 'unknown'}`
                );
            }
            json = await response.json();
        } catch (e: any) {
            // JSON parsing failed or content-type check threw
            if (e.message?.startsWith('HTTP ') || e.message?.includes('非JSON响应')) {
                throw e; // Re-throw our own errors
            }
            // Unexpected JSON parse error
            this.logger.error(`JSON解析失败: ${e.message}`);
            throw new Error(
                !response.ok
                    ? `HTTP ${response.status}: ${response.statusText}`
                    : `响应JSON解析失败: ${e.message}`
            );
        }

        if (!response.ok || !json.success) {
            this.logger.error(`上传失败响应: ${response.status} ${response.statusText}`, json);
            throw new Error(json.error || response.statusText || '未知错误');
        }

        return {etag: json.etag};
    }
}
