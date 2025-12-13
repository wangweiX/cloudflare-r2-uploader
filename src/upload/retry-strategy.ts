import {UploadConfig, UploadError} from '../types';

/**
 * Retry strategy configuration
 */
export interface RetryConfig {
    maxRetries: number;
    retryDelay: number;
    maxRetryDelay: number;
}

/**
 * Result of retry decision
 */
export interface RetryDecision {
    shouldRetry: boolean;
    delay: number;
    reason?: string;
}

/**
 * Retry strategy interface - allows for different retry policies
 */
export interface IRetryStrategy {
    /**
     * Decide whether to retry and calculate delay
     */
    decide(error: UploadError, retryCount: number): RetryDecision;

    /**
     * Update configuration
     */
    updateConfig(config: Partial<RetryConfig>): void;
}

/**
 * Non-retryable error types
 */
const NON_RETRYABLE_ERRORS: Set<UploadError['type']> = new Set(['auth']);

/**
 * Retryable error types
 */
const RETRYABLE_ERRORS: Set<UploadError['type']> = new Set([
    'timeout',
    'network',
    'server',
    'unknown'
]);

/**
 * Exponential backoff retry strategy.
 *
 * Features:
 * - Exponential delay: baseDelay * 2^(retryCount-1)
 * - Maximum delay cap
 * - Error type classification (auth errors are not retried)
 * - Configurable parameters
 */
export class ExponentialBackoffStrategy implements IRetryStrategy {
    private config: RetryConfig;

    constructor(config: RetryConfig) {
        this.config = {...config};
    }

    /**
     * Create from UploadConfig
     */
    static fromUploadConfig(config: UploadConfig): ExponentialBackoffStrategy {
        return new ExponentialBackoffStrategy({
            maxRetries: config.maxRetries,
            retryDelay: config.retryDelay,
            maxRetryDelay: config.maxRetryDelay
        });
    }

    public decide(error: UploadError, retryCount: number): RetryDecision {
        // Check if error type is retryable
        if (NON_RETRYABLE_ERRORS.has(error.type)) {
            return {
                shouldRetry: false,
                delay: 0,
                reason: `Error type '${error.type}' is not retryable`
            };
        }

        // Check if we've exceeded max retries
        if (retryCount >= this.config.maxRetries) {
            return {
                shouldRetry: false,
                delay: 0,
                reason: `Max retries (${this.config.maxRetries}) exceeded`
            };
        }

        // Check if error type is in the retryable list
        if (!RETRYABLE_ERRORS.has(error.type)) {
            return {
                shouldRetry: false,
                delay: 0,
                reason: `Unknown error type '${error.type}'`
            };
        }

        // Calculate exponential backoff delay
        const delay = this.calculateDelay(retryCount);

        return {
            shouldRetry: true,
            delay,
            reason: `Retry ${retryCount + 1}/${this.config.maxRetries} after ${delay}ms`
        };
    }

    /**
     * Calculate delay using exponential backoff with jitter
     *
     * Formula: min(maxDelay, baseDelay * 2^retryCount)
     */
    private calculateDelay(retryCount: number): number {
        const exponentialDelay = this.config.retryDelay * Math.pow(2, retryCount);
        return Math.min(exponentialDelay, this.config.maxRetryDelay);
    }

    public updateConfig(config: Partial<RetryConfig>): void {
        this.config = {...this.config, ...config};
    }

    /**
     * Get current configuration
     */
    public getConfig(): Readonly<RetryConfig> {
        return {...this.config};
    }
}
