import {S3Client, PutObjectCommand} from '@aws-sdk/client-s3';
import {R2S3Settings, StorageProviderType} from '../types';
import {BaseStorageProvider, ErrorClassifier, ExecuteUploadResult, isCommonNetworkError, ProviderUploadSettings} from './base.provider';

/**
 * R2 S3 API provider - handles uploads directly via Cloudflare R2 S3-compatible API.
 *
 * Only implements the provider-specific abstract methods.
 * The upload algorithm is defined in BaseStorageProvider.uploadImage().
 */
export class R2S3Service extends BaseStorageProvider {
    private static readonly ERROR_CLASSIFIER: ErrorClassifier = {
        isAuthError: (err, msg) =>
            ['CredentialsProviderError', 'InvalidSignatureException'].includes(err.name) ||
            msg.includes('配置不完整') || msg.includes('403') || msg.includes('Access Denied'),
        isNetworkError: (err, msg) =>
            isCommonNetworkError(err) ||
            err.name === 'NetworkError' ||
            ['Failed to fetch', '网络', 'CORS'].some(s => msg.includes(s)),
        isServerError: (err) => err.$metadata?.httpStatusCode >= 500,
        getErrorCode: (err) => err.Code || err.name || err.$metadata?.httpStatusCode
    };

    private readonly s3Client: S3Client;

    constructor(private settings: R2S3Settings) {
        super();
        this.s3Client = new S3Client({
            region: 'auto',
            endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
            credentials: {
                accessKeyId: settings.accessKeyId,
                secretAccessKey: settings.secretAccessKey,
            },
            forcePathStyle: true,
        });
    }

    public getType(): StorageProviderType {
        return StorageProviderType.R2_S3_API;
    }

    protected validateSettings(): void {
        if (!this.settings.bucketName) {
            throw new Error('R2 S3 API 配置不完整：缺少存储桶名称');
        }
    }

    protected getUploadSettings(): ProviderUploadSettings {
        return {
            folderName: this.settings.folderName,
            customDomain: this.settings.customDomain
        };
    }

    /**
     * Returns the fallback base URL for R2 storage.
     *
     * Note: This URL includes the bucket name as a path segment because R2's
     * public URL format is: https://{accountId}.r2.cloudflarestorage.com/{bucket}/{key}
     *
     * The buildPublicUrl in base class will append filePath to this, resulting in:
     * https://{accountId}.r2.cloudflarestorage.com/{bucket}/{folder}/{file}
     *
     * Do NOT add bucket to filePath separately - it's already included here.
     */
    protected getFallbackBaseUrl(): string {
        const {accountId, bucketName} = this.settings;
        return `https://${accountId}.r2.cloudflarestorage.com/${bucketName}`;
    }

    protected getErrorClassifier(): ErrorClassifier {
        return R2S3Service.ERROR_CLASSIFIER;
    }

    protected async executeUpload(
        fileContent: ArrayBuffer,
        filePath: string,
        mimeType: string,
        signal: AbortSignal
    ): Promise<ExecuteUploadResult> {
        const response = await this.s3Client.send(
            new PutObjectCommand({
                Bucket: this.settings.bucketName,
                Key: filePath,
                Body: new Uint8Array(fileContent),
                ContentType: mimeType,
                ContentLength: fileContent.byteLength,
            }),
            {abortSignal: signal}
        );

        return {etag: response.ETag};
    }
}
