import {EventEmitter} from 'events';
import {App, TFile} from 'obsidian';
import {StorageProvider, UploadConfig, UploadTask} from '../types';
import {Logger} from '../utils';
import {UPLOAD_EVENTS} from '../config';
import {ExponentialBackoffStrategy, IRetryStrategy} from './retry-strategy';
import {ProgressInfo, TaskRunner, VaultFileReader} from './task-runner';

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
    private readonly taskRunner: TaskRunner;
    private readonly retryStrategy: IRetryStrategy;

    // Configuration
    private config: UploadConfig;
    private deleteAfterUpload: boolean = false;

    // Task queues
    private readonly queue: UploadTask[] = [];
    private readonly activeTasks: Map<string, UploadTask> = new Map();
    private readonly completedTasks: Map<string, UploadTask> = new Map();
    private readonly uploadedFiles: Set<string> = new Set();

    // Counters and flags
    private taskIdCounter = 0;
    private isProcessing = false;
    private isPaused = false;
    private processQueueTimeout: NodeJS.Timeout | null = null;

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
        const fileReader = new VaultFileReader(app);
        this.taskRunner = new TaskRunner(fileReader, storageProvider);
        this.retryStrategy = ExponentialBackoffStrategy.fromUploadConfig(config);
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

    setDeleteAfterUpload(value: boolean): void {
        this.deleteAfterUpload = value;
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
                    await this.executeTask(task);
                }
            }

            if (this.queue.length === 0 && this.activeTasks.size === 0) {
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

        // Progress callback
        const onProgress = (info: ProgressInfo) => {
            task.progress = info.progress;
            task.uploadedSize = info.uploadedSize;
            task.speed = info.speed;
            this.emit(UploadManager.EVENTS.TASK_PROGRESS, task);
        };

        // Execute via TaskRunner
        const result = await this.taskRunner.execute(
            task,
            this.config.timeout,
            onProgress
        );

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
                `任务失败，${decision.delay}ms 后重试 (${task.retryCount}/${this.config.maxRetries}): ${task.fileName}`,
                error
            );

            this.activeTasks.delete(task.id);

            setTimeout(() => {
                if (task.status === 'retrying') {
                    task.status = 'pending';
                    delete task.nextRetryAt;
                    this.queue.unshift(task);
                    this.scheduleProcessQueue();
                }
            }, decision.delay);
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

        // Check active tasks
        const activeTask = this.activeTasks.get(taskId);
        if (activeTask) {
            this.activeTasks.delete(taskId);
            this.markAsCancelled(activeTask);
            this.logger.info(`已取消任务: ${activeTask.fileName}`);
        }
    }

    private markAsCancelled(task: UploadTask): void {
        task.status = 'cancelled';
        task.completedAt = Date.now();
        this.completedTasks.set(task.id, task);
        this.emit(UploadManager.EVENTS.TASK_CANCELLED, task);
        this.emitStatsUpdate();
    }

    cancelAll(): void {
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
            ...Array.from(this.completedTasks.values())
        ];
    }

    private findTaskByPath(filePath: string): UploadTask | undefined {
        // Check queue
        let task = this.queue.find(t => t.filePath === filePath);
        if (task) return task;

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

    clearCompleted(): void {
        const completedIds = Array.from(this.completedTasks.entries())
            .filter(([_, task]) => task.status === 'completed')
            .map(([id]) => id);

        for (const id of completedIds) {
            this.completedTasks.delete(id);
        }

        this.logger.info(`已清理 ${completedIds.length} 个已完成任务`);
        this.emitStatsUpdate();
    }

    // ===== Event Helpers =====

    private emitStatsUpdate(): void {
        this.emit(UploadManager.EVENTS.STATS_UPDATED, this.getStats());
    }
}
