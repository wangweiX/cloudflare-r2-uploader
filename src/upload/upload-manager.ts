import {EventEmitter} from 'events';
import {App, TFile} from 'obsidian';
import {StorageProvider, UploadConfig, UploadTask} from '../types';
import {Logger} from '../utils';
import {UPLOAD_EVENTS} from '../config';
import {ExponentialBackoffStrategy, IRetryStrategy} from './retry-strategy';
import {ProgressInfo, TaskExecutionOptions, TaskRunner, VaultFileReader} from './task-runner';

/**
 * Upload statistics
 */
export interface UploadStats {
    total: number;
    pending: number;
    uploading: number;
    completed: number;
    failed: number;
    cancelled: number;
    totalSize: number;
    uploadedSize: number;
    isPaused: boolean;
}

/**
 * UploadManager - Orchestrates upload tasks.
 *
 * Responsibilities:
 * - Queue management (pending, active, completed tasks)
 * - Concurrency control
 * - Event emission for UI updates
 * - Delegates task execution to TaskRunner
 * - Delegates retry decisions to RetryStrategy
 *
 * Design Pattern: Singleton
 */
export class UploadManager extends EventEmitter {
    private static instance: UploadManager | null = null;

    // Dependencies
    private readonly app: App;
    private readonly logger: Logger;
    private taskRunner: TaskRunner;
    private readonly retryStrategy: IRetryStrategy;
    private readonly fileReader: VaultFileReader;

    // Configuration
    private config: UploadConfig;

    // Task queues
    private readonly queue: UploadTask[] = [];
    private readonly activeTasks: Map<string, UploadTask> = new Map();
    private readonly retryingTasks: Map<string, UploadTask> = new Map();
    private readonly completedTasks: Map<string, UploadTask> = new Map();
    private readonly uploadedFiles: Set<string> = new Set();

    // Abort controllers for active uploads (allows true cancellation)
    private readonly abortControllers: Map<string, AbortController> = new Map();
    private readonly retryTimers: Map<string, NodeJS.Timeout> = new Map();

    // Counters and flags
    private taskIdCounter = 0;
    private isProcessing = false;
    private isPaused = false;
    private processQueueTimeout: NodeJS.Timeout | null = null;
    private cleanupInterval: NodeJS.Timeout | null = null;

    // Auto-cleanup configuration
    // Tasks older than this will be automatically removed from completedTasks
    private static readonly CLEANUP_MAX_AGE_MS = 30 * 60 * 1000; // 30 minutes
    private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // Check every 5 minutes

    // Event constants
    static readonly EVENTS = UPLOAD_EVENTS;

    private constructor(
        app: App,
        storageProvider: StorageProvider,
        config: UploadConfig
    ) {
        super();
        this.app = app;
        this.config = config;
        this.logger = Logger.getInstance();

        // Initialize dependencies
        this.fileReader = new VaultFileReader(app);
        this.taskRunner = new TaskRunner(this.fileReader, storageProvider);
        this.retryStrategy = ExponentialBackoffStrategy.fromUploadConfig(config);

        // Start auto-cleanup interval
        this.startAutoCleanup();
    }

    // ===== Singleton Pattern =====

    static getInstance(app: App, storageProvider: StorageProvider, config: UploadConfig): UploadManager {
        if (!UploadManager.instance) {
            UploadManager.instance = new UploadManager(app, storageProvider, config);
        }
        return UploadManager.instance;
    }

    static destroyInstance(): void {
        if (UploadManager.instance) {
            UploadManager.instance.stopAutoCleanup();
            UploadManager.instance.cancelAll();
            UploadManager.instance.removeAllListeners();
            UploadManager.instance = null;
        }
    }

    // ===== Configuration =====

    updateConfig(config: Partial<UploadConfig>): void {
        this.config = {...this.config, ...config};
        if (this.retryStrategy instanceof ExponentialBackoffStrategy) {
            this.retryStrategy.updateConfig({
                maxRetries: this.config.maxRetries,
                retryDelay: this.config.retryDelay,
                maxRetryDelay: this.config.maxRetryDelay
            });
        }
        this.logger.info('上传管理器配置已更新', config);
    }

    /**
     * Update the storage provider.
     *
     * IMPORTANT: This should be called when switching between Worker and R2 S3 providers.
     * The method will:
     * 1. Abort any active uploads (interrupt network requests)
     * 2. Cancel any pending tasks
     * 3. Create a new TaskRunner with the new provider
     * 4. Clear upload history and reset state for a clean session
     */
    updateStorageProvider(storageProvider: StorageProvider): void {
        // Abort all active uploads first (this actually interrupts network requests)
        this.abortAllActiveUploads();

        // Cancel any pending/active tasks
        const hasPendingTasks = this.queue.length > 0 || this.activeTasks.size > 0 || this.retryingTasks.size > 0;
        if (hasPendingTasks) {
            this.cancelAll();
            this.logger.warn('切换存储提供者，已取消所有待处理任务');
        }

        // Create new TaskRunner with new provider
        this.taskRunner = new TaskRunner(this.fileReader, storageProvider);

        // Reset for clean session
        this.uploadedFiles.clear();
        this.completedTasks.clear();
        this.taskIdCounter = 0;

        this.logger.info(`存储提供者已切换: ${storageProvider.getType()}`);
        this.emitStatsUpdate();
    }

    /**
     * Abort all active upload requests
     */
    private abortAllActiveUploads(): void {
        for (const [taskId, controller] of this.abortControllers) {
            controller.abort();
            this.logger.info(`已中止上传请求: ${taskId}`);
        }
        this.abortControllers.clear();
    }

    // ===== Task Addition =====

    async addTask(filePath: string): Promise<UploadTask> {
        // Check if already uploaded
        if (this.uploadedFiles.has(filePath)) {
            this.logger.info(`文件已经上传过，跳过: ${filePath}`);
            throw new Error(`文件已经上传过: ${filePath}`);
        }

        // Check if already in queue
        const existingTask = this.findTaskByPath(filePath);
        if (existingTask) {
            this.logger.info(`文件已经在队列中: ${filePath}`);
            return existingTask;
        }

        // Get file info
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            throw new Error(`文件不存在: ${filePath}`);
        }

        // Create task
        const task: UploadTask = {
            id: `upload-${++this.taskIdCounter}`,
            filePath,
            fileName: file.name,
            fileSize: file.stat.size,
            status: 'pending',
            progress: 0,
            createdAt: Date.now(),
            retryCount: 0
        };

        // Add to queue
        this.queue.push(task);
        this.emit(UploadManager.EVENTS.TASK_ADDED, task);
        this.emitStatsUpdate();

        // Schedule processing
        this.scheduleProcessQueue();

        return task;
    }

    async addTasks(filePaths: string[]): Promise<UploadTask[]> {
        const tasks: UploadTask[] = [];
        for (const filePath of filePaths) {
            try {
                const task = await this.addTask(filePath);
                tasks.push(task);
            } catch (error) {
                this.logger.warn(`跳过文件: ${filePath}`, error);
            }
        }
        return tasks;
    }

    // ===== Queue Processing =====

    private scheduleProcessQueue(): void {
        if (this.processQueueTimeout) {
            clearTimeout(this.processQueueTimeout);
        }
        this.processQueueTimeout = setTimeout(() => this.processQueue(), 100);
    }

    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.isPaused) {
            return;
        }

        this.isProcessing = true;

        try {
            while (
                this.queue.length > 0 &&
                this.activeTasks.size < this.config.maxConcurrency &&
                !this.isPaused
                ) {
                const task = this.queue.shift();
                if (task) {
                    // Fire-and-forget to maintain concurrency (don't await!)
                    this.executeTask(task).catch(err => {
                        this.logger.error(`任务执行异常: ${task.fileName}`, err);
                    });
                }
            }

            if (this.queue.length === 0 && this.activeTasks.size === 0 && this.retryingTasks.size === 0) {
                this.emit(UploadManager.EVENTS.QUEUE_EMPTY);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    // ===== Task Execution =====

    private async executeTask(task: UploadTask): Promise<void> {
        // Update task state
        task.status = 'uploading';
        task.startedAt = Date.now();
        this.activeTasks.set(task.id, task);
        this.emit(UploadManager.EVENTS.TASK_STARTED, task);
        this.emitStatsUpdate();

        // Create abort controller for this task
        const abortController = new AbortController();
        this.abortControllers.set(task.id, abortController);

        // Progress callback
        const onProgress = (info: ProgressInfo) => {
            task.progress = info.progress;
            task.uploadedSize = info.uploadedSize;
            task.speed = info.speed;
            this.emit(UploadManager.EVENTS.TASK_PROGRESS, task);
        };

        // Execute via TaskRunner with abort signal
        const options: TaskExecutionOptions = {
            timeout: this.config.timeout,
            signal: abortController.signal
        };

        const result = await this.taskRunner.execute(task, options, onProgress);

        // Cleanup abort controller
        this.abortControllers.delete(task.id);

        // Guard: If task was cancelled during execution, don't process the result
        // This prevents a cancelled task from being marked as success/retry
        if (abortController.signal.aborted) {
            this.logger.info(`任务已取消，跳过结果处理: ${task.fileName}`);
            this.scheduleProcessQueue();
            return;
        }

        if (result.success) {
            this.handleTaskSuccess(task, result.url!);
        } else {
            await this.handleTaskError(task, result.error!);
        }

        // Continue processing queue
        this.scheduleProcessQueue();
    }

    private handleTaskSuccess(task: UploadTask, url: string): void {
        task.status = 'completed';
        task.completedAt = Date.now();
        task.url = url;
        task.progress = 1;
        task.uploadedSize = task.fileSize;

        // Record as uploaded
        this.uploadedFiles.add(task.filePath);

        // Move to completed
        this.activeTasks.delete(task.id);
        this.completedTasks.set(task.id, task);

        this.emit(UploadManager.EVENTS.TASK_COMPLETED, task);
        this.emitStatsUpdate();

        this.logger.info(`上传成功: ${task.fileName} -> ${url}`);
    }

    private async handleTaskError(task: UploadTask, error: any): Promise<void> {
        task.error = error;
        task.retryCount = (task.retryCount || 0) + 1;

        // Ask retry strategy
        const decision = this.retryStrategy.decide(error, task.retryCount);

        if (decision.shouldRetry) {
            // Schedule retry
            task.status = 'retrying';
            task.nextRetryAt = Date.now() + decision.delay;

            this.logger.warn(
                `任务失败，第 ${task.retryCount}/${this.config.maxRetries} 次重试，${decision.delay}ms 后执行: ${task.fileName}`,
                error
            );

            this.activeTasks.delete(task.id);
            this.retryingTasks.set(task.id, task);

            const existingTimer = this.retryTimers.get(task.id);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }

            const timer = setTimeout(() => {
                this.retryTimers.delete(task.id);

                if (task.status !== 'retrying') {
                    this.retryingTasks.delete(task.id);
                    return;
                }

                task.status = 'pending';
                delete task.nextRetryAt;
                this.retryingTasks.delete(task.id);
                this.queue.unshift(task);
                this.scheduleProcessQueue();
            }, decision.delay);

            this.retryTimers.set(task.id, timer);
        } else {
            // Mark as failed
            task.status = 'failed';
            task.completedAt = Date.now();
            task.progress = 0;
            delete task.uploadedSize;
            delete task.speed;

            this.logger.error(`任务失败: ${task.fileName}`, error);

            this.activeTasks.delete(task.id);
            this.completedTasks.set(task.id, task);

            this.emit(UploadManager.EVENTS.TASK_FAILED, task);
        }

        this.emitStatsUpdate();
    }

    // ===== Task Control =====

    cancelTask(taskId: string): void {
        // Check queue
        const queueIndex = this.queue.findIndex(t => t.id === taskId);
        if (queueIndex !== -1) {
            const task = this.queue.splice(queueIndex, 1)[0];
            this.markAsCancelled(task);
            return;
        }

        // Check retrying tasks
        const retryingTask = this.retryingTasks.get(taskId);
        if (retryingTask) {
            const timer = this.retryTimers.get(taskId);
            if (timer) {
                clearTimeout(timer);
                this.retryTimers.delete(taskId);
            }

            this.retryingTasks.delete(taskId);
            this.markAsCancelled(retryingTask);
            this.logger.info(`已取消任务: ${retryingTask.fileName}`);
            return;
        }

        // Check active tasks
        const activeTask = this.activeTasks.get(taskId);
        if (activeTask) {
            // Abort the upload request
            const controller = this.abortControllers.get(taskId);
            if (controller) {
                controller.abort();
                this.abortControllers.delete(taskId);
            }

            this.activeTasks.delete(taskId);
            this.markAsCancelled(activeTask);
            this.logger.info(`已取消任务: ${activeTask.fileName}`);
        }
    }

    private markAsCancelled(task: UploadTask): void {
        task.status = 'cancelled';
        task.completedAt = Date.now();
        delete task.nextRetryAt;
        this.completedTasks.set(task.id, task);
        this.emit(UploadManager.EVENTS.TASK_CANCELLED, task);
        this.emitStatsUpdate();
    }

    cancelAll(): void {
        // Abort all active upload requests first
        this.abortAllActiveUploads();

        // Cancel retrying tasks (scheduled timers)
        for (const [taskId, timer] of this.retryTimers) {
            clearTimeout(timer);
            this.logger.info(`已取消重试定时器: ${taskId}`);
        }
        this.retryTimers.clear();

        for (const task of this.retryingTasks.values()) {
            this.markAsCancelled(task);
        }
        this.retryingTasks.clear();

        // Cancel queued tasks
        while (this.queue.length > 0) {
            const task = this.queue.shift()!;
            this.markAsCancelled(task);
        }

        // Cancel active tasks
        for (const task of this.activeTasks.values()) {
            this.markAsCancelled(task);
        }
        this.activeTasks.clear();

        this.logger.info('已取消所有上传任务');
    }

    retryFailed(): void {
        const failedTasks = Array.from(this.completedTasks.values())
            .filter(t => t.status === 'failed');

        for (const task of failedTasks) {
            // Reset task state
            task.status = 'pending';
            task.retryCount = 0;
            task.progress = 0;
            delete task.error;
            delete task.startedAt;
            delete task.completedAt;
            delete task.uploadedSize;
            delete task.speed;

            this.completedTasks.delete(task.id);
            this.queue.push(task);
        }

        if (failedTasks.length > 0) {
            this.logger.info(`已将 ${failedTasks.length} 个失败任务重新加入队列`);
            this.emitStatsUpdate();
            this.scheduleProcessQueue();
        }
    }

    togglePause(): void {
        this.isPaused = !this.isPaused;
        if (!this.isPaused) {
            this.scheduleProcessQueue();
        }
        this.logger.info(this.isPaused ? '已暂停上传' : '已恢复上传');
    }

    // ===== Statistics & Queries =====

    getStats(): UploadStats {
        const allTasks = this.getAllTasks();

        const stats: UploadStats = {
            total: allTasks.length,
            pending: this.queue.length,
            uploading: this.activeTasks.size,
            completed: 0,
            failed: 0,
            cancelled: 0,
            totalSize: 0,
            uploadedSize: 0,
            isPaused: this.isPaused
        };

        for (const task of allTasks) {
            stats.totalSize += task.fileSize;

            switch (task.status) {
                case 'completed':
                    stats.completed++;
                    stats.uploadedSize += task.fileSize;
                    break;
                case 'failed':
                    stats.failed++;
                    break;
                case 'cancelled':
                    stats.cancelled++;
                    break;
                default:
                    if (task.uploadedSize) {
                        stats.uploadedSize += task.uploadedSize;
                    }
            }
        }

        return stats;
    }

    getAllTasks(): UploadTask[] {
        return [
            ...this.queue,
            ...Array.from(this.activeTasks.values()),
            ...Array.from(this.retryingTasks.values()),
            ...Array.from(this.completedTasks.values())
        ];
    }

    private findTaskByPath(filePath: string): UploadTask | undefined {
        // Check queue
        let task = this.queue.find(t => t.filePath === filePath);
        if (task) return task;

        // Check retrying tasks
        for (const t of this.retryingTasks.values()) {
            if (t.filePath === filePath) return t;
        }

        // Check active
        for (const t of this.activeTasks.values()) {
            if (t.filePath === filePath) return t;
        }

        // Check completed (only successful)
        for (const t of this.completedTasks.values()) {
            if (t.filePath === filePath && t.status === 'completed') return t;
        }

        return undefined;
    }

    // ===== Cleanup =====

    /**
     * Start periodic auto-cleanup of old tasks
     */
    private startAutoCleanup(): void {
        this.stopAutoCleanup();
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldTasks();
        }, UploadManager.CLEANUP_INTERVAL_MS);
    }

    /**
     * Stop auto-cleanup interval
     */
    private stopAutoCleanup(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    /**
     * Remove old completed/failed/cancelled tasks from memory
     * Called automatically by cleanup interval
     */
    private cleanupOldTasks(): void {
        const now = Date.now();
        const maxAge = UploadManager.CLEANUP_MAX_AGE_MS;
        let cleanedCount = 0;

        for (const [id, task] of this.completedTasks) {
            const taskAge = now - (task.completedAt || task.createdAt);
            if (taskAge > maxAge) {
                this.completedTasks.delete(id);
                if (task.status === 'completed') {
                    this.uploadedFiles.delete(task.filePath);
                }
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.info(`自动清理了 ${cleanedCount} 个旧任务`);
            this.emitStatsUpdate();
        }
    }

    /**
     * Manually clear completed tasks
     * @param includeFailedAndCancelled If true, also clears failed and cancelled tasks
     */
    clearCompleted(includeFailedAndCancelled = false): void {
        const tasksToRemove = Array.from(this.completedTasks.entries())
            .filter(([_, task]) => {
                if (task.status === 'completed') return true;
                if (includeFailedAndCancelled && (task.status === 'failed' || task.status === 'cancelled')) return true;
                return false;
            });

        for (const [id, task] of tasksToRemove) {
            this.completedTasks.delete(id);
            if (task.status === 'completed') {
                this.uploadedFiles.delete(task.filePath);
            }
        }

        this.logger.info(`已清理 ${tasksToRemove.length} 个任务`);
        this.emitStatsUpdate();
    }

    // ===== Event Helpers =====

    private emitStatsUpdate(): void {
        this.emit(UploadManager.EVENTS.STATS_UPDATED, this.getStats());
    }
}
