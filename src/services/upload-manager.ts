import {EventEmitter} from 'events';
import {App, TFile} from 'obsidian';
import {StorageProvider} from '../models/storage-provider';
import {UploadConfig, UploadError, UploadTask} from '../models/upload-task';
import {Logger} from '../utils/logger';

/**
 * 上传管理器 - 单例模式
 * 负责管理所有上传任务的队列、并发控制、重试逻辑等
 */
export class UploadManager extends EventEmitter {
    private static instance: UploadManager | null = null;
    private readonly app: App;
    private readonly storageProvider: StorageProvider;
    private config: UploadConfig;
    private readonly logger: Logger;
    private deleteAfterUpload: boolean = false;

    // 任务队列
    private readonly queue: UploadTask[] = [];
    private readonly activeTasks: Map<string, UploadTask> = new Map();
    private readonly completedTasks: Map<string, UploadTask> = new Map();
    private readonly uploadedFiles: Set<string> = new Set(); // 记录已上传的文件路径

    // 任务计数器
    private taskIdCounter = 0;

    // 控制标志
    private isProcessing = false;
    private isPaused = false;

    // 防抖定时器
    private processQueueTimeout: NodeJS.Timeout | null = null;

    // 事件定义
    static readonly EVENTS = {
        TASK_ADDED: 'task:added',
        TASK_STARTED: 'task:started',
        TASK_PROGRESS: 'task:progress',
        TASK_COMPLETED: 'task:completed',
        TASK_FAILED: 'task:failed',
        TASK_CANCELLED: 'task:cancelled',
        QUEUE_EMPTY: 'queue:empty',
        STATS_UPDATED: 'stats:updated'
    };

    private constructor(app: App, storageProvider: StorageProvider, config: UploadConfig) {
        super();
        this.app = app;
        this.storageProvider = storageProvider;
        this.config = config;
        this.logger = Logger.getInstance();
    }

    /**
     * 获取单例实例
     */
    static getInstance(app: App, storageProvider: StorageProvider, config: UploadConfig): UploadManager {
        if (!UploadManager.instance) {
            UploadManager.instance = new UploadManager(app, storageProvider, config);
        }
        return UploadManager.instance;
    }

    /**
     * 销毁单例实例
     */
    static destroyInstance(): void {
        if (UploadManager.instance) {
            UploadManager.instance.cancelAll();
            UploadManager.instance.removeAllListeners();
            UploadManager.instance = null;
        }
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<UploadConfig>): void {
        this.config = {...this.config, ...config};
        this.logger.info('上传管理器配置已更新', config);
    }

    /**
     * 设置是否在上传成功后删除本地文件
     */
    setDeleteAfterUpload(value: boolean): void {
        this.deleteAfterUpload = value;
    }

    /**
     * 添加单个任务到队列
     */
    async addTask(filePath: string): Promise<UploadTask> {
        // 检查是否已经上传过
        if (this.uploadedFiles.has(filePath)) {
            this.logger.info(`文件已经上传过，跳过: ${filePath}`);
            throw new Error(`文件已经上传过: ${filePath}`);
        }

        // 检查是否已经在队列中
        const existingTask = this.findTaskByPath(filePath);
        if (existingTask) {
            this.logger.info(`文件已经在队列中: ${filePath}`);
            return existingTask;
        }

        // 获取文件信息
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) {
            throw new Error(`文件不存在: ${filePath}`);
        }

        // 创建任务
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

        // 添加到队列
        this.queue.push(task);
        this.emit(UploadManager.EVENTS.TASK_ADDED, task);
        this.emitStatsUpdate();

        // 触发队列处理（防抖）
        this.scheduleProcessQueue();

        return task;
    }

    /**
     * 批量添加任务
     */
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

    /**
     * 安排处理队列（防抖）
     */
    private scheduleProcessQueue(): void {
        if (this.processQueueTimeout) {
            clearTimeout(this.processQueueTimeout);
        }

        this.processQueueTimeout = setTimeout(() => {
            this.processQueue();
        }, 100); // 100ms 防抖
    }

    /**
     * 处理队列
     */
    private async processQueue(): Promise<void> {
        if (this.isProcessing || this.isPaused) {
            return;
        }

        this.isProcessing = true;

        try {
            while (this.queue.length > 0 && this.activeTasks.size < this.config.maxConcurrency && !this.isPaused) {
                const task = this.queue.shift();
                if (task) {
                    this.startTask(task);
                }
            }

            // 如果队列为空且没有活动任务，触发队列空事件
            if (this.queue.length === 0 && this.activeTasks.size === 0) {
                this.emit(UploadManager.EVENTS.QUEUE_EMPTY);
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * 开始任务
     */
    private async startTask(task: UploadTask): Promise<void> {
        task.status = 'uploading';
        task.startedAt = Date.now();
        this.activeTasks.set(task.id, task);
        this.emit(UploadManager.EVENTS.TASK_STARTED, task);
        this.emitStatsUpdate();

        try {
            // 获取文件内容
            const file = this.app.vault.getAbstractFileByPath(task.filePath);
            if (!(file instanceof TFile)) {
                throw new Error(`文件不存在: ${task.filePath}`);
            }

            const arrayBuffer = await this.app.vault.readBinary(file);

            // 创建进度回调
            const onProgress = (progress: number) => {
                task.progress = progress;
                task.uploadedSize = Math.floor(task.fileSize * progress);

                // 计算速度
                if (task.startedAt) {
                    const elapsedSeconds = (Date.now() - task.startedAt) / 1000;
                    if (elapsedSeconds > 0 && task.uploadedSize) {
                        task.speed = task.uploadedSize / elapsedSeconds;
                    }
                }

                this.emit(UploadManager.EVENTS.TASK_PROGRESS, task);
            };

            // 执行上传
            const result = await this.storageProvider.uploadImage(
                arrayBuffer,
                task.fileName,
                onProgress,
                {timeout: this.config.timeout}
            );

            // 上传成功
            task.status = 'completed';
            task.completedAt = Date.now();
            task.url = result.url;
            task.progress = 1;
            task.uploadedSize = task.fileSize;

            // 记录已上传的文件
            this.uploadedFiles.add(task.filePath);

            // 移动到完成队列
            this.activeTasks.delete(task.id);
            this.completedTasks.set(task.id, task);

            this.emit(UploadManager.EVENTS.TASK_COMPLETED, task);
            this.emitStatsUpdate();

            this.logger.info(`上传成功: ${task.fileName} -> ${result.url}`);

            // 不在这里删除文件，而是等待链接更新后再删除

        } catch (error) {
            await this.handleTaskError(task, error);
        } finally {
            // 继续处理队列
            this.scheduleProcessQueue();
        }
    }

    /**
     * 处理任务错误
     */
    private async handleTaskError(task: UploadTask, error: any): Promise<void> {
        task.error = this.normalizeError(error);
        task.retryCount = (task.retryCount || 0) + 1;

        // 判断是否需要重试
        if (task.retryCount < this.config.maxRetries && this.shouldRetry(task.error)) {
            // 计算重试延迟（指数退避）
            const delay = Math.min(
                this.config.retryDelay * Math.pow(2, task.retryCount - 1),
                this.config.maxRetryDelay
            );

            task.status = 'retrying';
            task.nextRetryAt = Date.now() + delay;

            this.logger.warn(`任务失败，${delay}ms 后重试 (${task.retryCount}/${this.config.maxRetries}): ${task.fileName}`, error);

            // 从活动任务中移除
            this.activeTasks.delete(task.id);

            // 延迟后重新加入队列
            setTimeout(() => {
                if (task.status === 'retrying') {
                    task.status = 'pending';
                    delete task.nextRetryAt;
                    this.queue.unshift(task); // 放到队列前面
                    this.scheduleProcessQueue();
                }
            }, delay);

        } else {
            // 不再重试，标记为失败
            task.status = 'failed';
            task.completedAt = Date.now();
            // 失败时清除进度相关信息
            task.progress = 0;
            delete task.uploadedSize;
            delete task.speed;

            this.logger.error(`任务失败: ${task.fileName}`, error);

            // 从活动任务中移除
            this.activeTasks.delete(task.id);
            this.completedTasks.set(task.id, task);

            this.emit(UploadManager.EVENTS.TASK_FAILED, task);
        }

        this.emitStatsUpdate();
    }

    /**
     * 规范化错误对象
     */
    private normalizeError(error: any): UploadError {
        if (error.type) {
            return error as UploadError;
        }

        // 分析错误类型
        let type: UploadError['type'] = 'unknown';
        const message = error.message || String(error);

        if (message.includes('timeout') || message.includes('超时')) {
            type = 'timeout';
        } else if (message.includes('network') || message.includes('网络')) {
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
     * 判断是否应该重试
     */
    private shouldRetry(error: UploadError): boolean {
        // 认证错误不重试
        if (error.type === 'auth') {
            return false;
        }

        // 其他错误类型都可以重试
        return ['timeout', 'network', 'server', 'unknown'].includes(error.type);
    }

    /**
     * 取消任务
     */
    cancelTask(taskId: string): void {
        // 从队列中移除
        const queueIndex = this.queue.findIndex(t => t.id === taskId);
        if (queueIndex !== -1) {
            const task = this.queue.splice(queueIndex, 1)[0];
            task.status = 'cancelled';
            task.completedAt = Date.now();
            this.completedTasks.set(task.id, task);
            this.emit(UploadManager.EVENTS.TASK_CANCELLED, task);
            this.emitStatsUpdate();
            return;
        }

        // 从活动任务中移除
        const activeTask = this.activeTasks.get(taskId);
        if (activeTask) {
            activeTask.status = 'cancelled';
            activeTask.completedAt = Date.now();
            this.activeTasks.delete(taskId);
            this.completedTasks.set(activeTask.id, activeTask);
            this.emit(UploadManager.EVENTS.TASK_CANCELLED, activeTask);
            this.emitStatsUpdate();

            // TODO: 实现实际的上传取消逻辑
            this.logger.info(`已取消任务: ${activeTask.fileName}`);
        }
    }

    /**
     * 取消所有任务
     */
    cancelAll(): void {
        // 取消队列中的任务
        while (this.queue.length > 0) {
            const task = this.queue.shift()!;
            task.status = 'cancelled';
            task.completedAt = Date.now();
            this.completedTasks.set(task.id, task);
            this.emit(UploadManager.EVENTS.TASK_CANCELLED, task);
        }

        // 取消活动任务
        for (const task of this.activeTasks.values()) {
            task.status = 'cancelled';
            task.completedAt = Date.now();
            this.completedTasks.set(task.id, task);
            this.emit(UploadManager.EVENTS.TASK_CANCELLED, task);
        }
        this.activeTasks.clear();

        this.emitStatsUpdate();
        this.logger.info('已取消所有上传任务');
    }

    /**
     * 重试失败的任务
     */
    retryFailed(): void {
        const failedTasks = Array.from(this.completedTasks.values()).filter(t => t.status === 'failed');

        for (const task of failedTasks) {
            // 重置任务状态
            task.status = 'pending';
            task.retryCount = 0;
            delete task.error;
            delete task.startedAt;
            delete task.completedAt;
            delete task.uploadedSize;
            delete task.speed;
            task.progress = 0;

            // 从完成任务中移除
            this.completedTasks.delete(task.id);

            // 重新加入队列
            this.queue.push(task);
        }

        if (failedTasks.length > 0) {
            this.logger.info(`已将 ${failedTasks.length} 个失败任务重新加入队列`);
            this.emitStatsUpdate();
            this.scheduleProcessQueue();
        }
    }

    /**
     * 暂停/恢复处理
     */
    togglePause(): void {
        this.isPaused = !this.isPaused;
        if (!this.isPaused) {
            this.scheduleProcessQueue();
        }
        this.logger.info(this.isPaused ? '已暂停上传' : '已恢复上传');
    }

    /**
     * 获取任务统计信息
     */
    getStats() {
        const allTasks = [
            ...this.queue,
            ...Array.from(this.activeTasks.values()),
            ...Array.from(this.completedTasks.values())
        ];

        const stats = {
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

            if (task.status === 'completed') {
                stats.completed++;
                stats.uploadedSize += task.fileSize;
            } else if (task.status === 'failed') {
                stats.failed++;
            } else if (task.status === 'cancelled') {
                stats.cancelled++;
            } else if (task.uploadedSize) {
                stats.uploadedSize += task.uploadedSize;
            }
        }

        return stats;
    }

    /**
     * 获取所有任务
     */
    getAllTasks(): UploadTask[] {
        return [
            ...this.queue,
            ...Array.from(this.activeTasks.values()),
            ...Array.from(this.completedTasks.values())
        ];
    }

    /**
     * 根据路径查找任务
     */
    private findTaskByPath(filePath: string): UploadTask | undefined {
        // 在队列中查找
        let task = this.queue.find(t => t.filePath === filePath);
        if (task) return task;

        // 在活动任务中查找
        for (const t of this.activeTasks.values()) {
            if (t.filePath === filePath) return t;
        }

        // 在完成任务中查找（只查找成功的）
        for (const t of this.completedTasks.values()) {
            if (t.filePath === filePath && t.status === 'completed') return t;
        }

        return undefined;
    }

    /**
     * 发送统计更新事件
     */
    private emitStatsUpdate(): void {
        this.emit(UploadManager.EVENTS.STATS_UPDATED, this.getStats());
    }

    /**
     * 清理完成的任务
     */
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
}