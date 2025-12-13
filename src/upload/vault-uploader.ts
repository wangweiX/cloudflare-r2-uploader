import {App, Notice, TFile} from 'obsidian';
import {ImageFinder, LinkUpdater} from '../image';
import {PluginSettings, UploadTask} from '../types';
import {Logger} from '../utils';
import {UploadManager} from './upload-manager';

/**
 * VaultUploader orchestrates a closed-loop pipeline for the entire vault:
 * 1) Scan all markdown notes and collect local image references (resolved to vault-absolute paths)
 * 2) Enqueue uploads via UploadManager
 * 3) Wait for the enqueued tasks to reach a terminal status (events + polling safety net)
 * 4) Rewrite links in all notes via LinkUpdater using absolutePath -> url mappings
 * 5) Optional safe deletion: rescan the vault, and only delete uploaded files that are no longer referenced
 *
 * Safety properties:
 * - Deletion is only performed after a full verification scan succeeds with zero scan errors.
 * - Files still referenced by any note after rewrite are never deleted.
 */
export interface VaultUploadResult {
    totalNotes: number;
    referencedLocalImages: number;
    queuedTasks: number;
    successfulUploads: number;
    failedUploads: number;
    cancelledUploads: number;
    modifiedNotes: number;
    replacedLinks: number;
    deletionEnabled: boolean;
    verifiedNotes: number;
    skippedDeletionDueToScanErrors: boolean;
    stillReferencedAfterRewrite: number;
    deletedLocalFiles: number;
    deleteErrors: number;
}

type TerminalStatus = 'completed' | 'failed' | 'cancelled';

function isTerminalStatus(status: UploadTask['status']): status is TerminalStatus {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export class VaultUploader {
    private readonly logger: Logger;
    private readonly finder: ImageFinder;
    private readonly updater: LinkUpdater;

    private isProcessing = false;
    private lastProcessTime = 0;
    private readonly debounceDelayMs = 1000;

    constructor(
        private readonly app: App,
        private readonly uploadManager: UploadManager,
        private readonly getSettings: () => PluginSettings
    ) {
        this.logger = Logger.getInstance();
        this.finder = new ImageFinder(app, app.vault.adapter);
        this.updater = new LinkUpdater(app.vault.adapter);
    }

    public async processVault(): Promise<VaultUploadResult | null> {
        if (!this.checkDebounce()) {
            return null;
        }

        if (this.isProcessing) {
            new Notice('已有一个全库处理任务在运行，请等待完成。', 3000);
            return null;
        }

        this.isProcessing = true;
        const progressNotice = new Notice('正在准备全库处理...', 0);

        try {
            const markdownFiles = this.app.vault.getMarkdownFiles();

            progressNotice.setMessage(`正在扫描笔记... (0/${markdownFiles.length})`);
            const initialScan = await this.scanReferencedImages(markdownFiles, progressNotice, '正在扫描笔记');

            if (initialScan.paths.size === 0) {
                progressNotice.hide();
                new Notice('Vault 中未发现需要上传的本地图片。', 3000);
                return {
                    totalNotes: markdownFiles.length,
                    referencedLocalImages: 0,
                    queuedTasks: 0,
                    successfulUploads: 0,
                    failedUploads: 0,
                    cancelledUploads: 0,
                    modifiedNotes: 0,
                    replacedLinks: 0,
                    deletionEnabled: this.getSettings().deleteAfterUpload,
                    verifiedNotes: 0,
                    skippedDeletionDueToScanErrors: false,
                    stillReferencedAfterRewrite: 0,
                    deletedLocalFiles: 0,
                    deleteErrors: 0
                };
            }

            progressNotice.setMessage(`正在将 ${initialScan.paths.size} 张图片加入上传队列...`);
            const tasks = await this.uploadManager.addTasks(Array.from(initialScan.paths));

            progressNotice.setMessage(`正在上传图片... (0/${tasks.length})`);
            await this.waitForTerminalTasks(tasks, progressNotice, '正在上传图片');

            // Use the UploadManager's in-memory history to build a complete mapping.
            // This enables link rewriting even for images that were uploaded earlier in the same session
            // but were deduplicated (not re-enqueued) during this run.
            const completedTasks = this.getCompletedTasksForPaths(initialScan.paths);
            const replacements = this.buildReplacementMap(completedTasks);

            progressNotice.setMessage(`正在替换笔记中的图片链接... (0/${markdownFiles.length})`);
            const rewriteStats = await this.rewriteLinks(markdownFiles, replacements, progressNotice);

            const settings = this.getSettings();
            const deletionEnabled = settings.deleteAfterUpload;

            let skippedDeletionDueToScanErrors = false;
            let stillReferencedAfterRewrite = 0;
            let deletedLocalFiles = 0;
            let deleteErrors = 0;
            let verifiedNotes = 0;

            if (deletionEnabled && Object.keys(replacements).length > 0) {
                progressNotice.setMessage(`正在验证删除前的引用情况... (0/${markdownFiles.length})`);
                const verificationScan = await this.scanReferencedImages(
                    markdownFiles,
                    progressNotice,
                    '正在验证引用'
                );
                verifiedNotes = markdownFiles.length;

                if (verificationScan.errorCount > 0) {
                    skippedDeletionDueToScanErrors = true;
                    this.logger.warn(
                        `Skipping deletion because verification scan had ${verificationScan.errorCount} errors`
                    );
                } else {
                    const uploadedPaths = Object.keys(replacements);
                    const referencedAfterRewrite = verificationScan.paths;
                    const deletable = uploadedPaths.filter(p => !referencedAfterRewrite.has(p));
                    stillReferencedAfterRewrite = uploadedPaths.length - deletable.length;

                    if (stillReferencedAfterRewrite > 0) {
                        this.logger.warn(
                            `Skipping deletion for ${stillReferencedAfterRewrite} files still referenced after rewrite`
                        );
                    }

                    if (deletable.length > 0) {
                        progressNotice.setMessage(`正在删除本地文件... (0/${deletable.length})`);
                        const deletionStats = await this.deleteLocalFiles(deletable, progressNotice);
                        deletedLocalFiles = deletionStats.deletedCount;
                        deleteErrors = deletionStats.errorCount;
                    }
                }
            }

            progressNotice.hide();

            const summary = this.summarizeTasks(tasks);

            return {
                totalNotes: markdownFiles.length,
                referencedLocalImages: initialScan.paths.size,
                queuedTasks: tasks.length,
                successfulUploads: completedTasks.length,
                failedUploads: summary.failed,
                cancelledUploads: summary.cancelled,
                modifiedNotes: rewriteStats.modifiedNotes,
                replacedLinks: rewriteStats.replacedLinks,
                deletionEnabled,
                verifiedNotes,
                skippedDeletionDueToScanErrors,
                stillReferencedAfterRewrite,
                deletedLocalFiles,
                deleteErrors
            };
        } catch (error) {
            progressNotice.hide();
            this.logger.error('Vault upload failed', error);
            new Notice(`全库处理失败：${(error as Error).message}`, 5000);
            return null;
        } finally {
            this.isProcessing = false;
        }
    }

    private checkDebounce(): boolean {
        const now = Date.now();
        if (now - this.lastProcessTime < this.debounceDelayMs) {
            new Notice('操作过于频繁，请稍后再试。', 2000);
            return false;
        }
        this.lastProcessTime = now;
        return true;
    }

    private async scanReferencedImages(
        markdownFiles: TFile[],
        notice: Notice,
        label: string
    ): Promise<{paths: Set<string>; errorCount: number}> {
        // errorCount is intentionally tracked: any scan error will abort the deletion phase
        // because we cannot safely guarantee that there are no remaining references.
        const paths = new Set<string>();
        let errorCount = 0;

        for (let i = 0; i < markdownFiles.length; i++) {
            const file = markdownFiles[i];
            if (i % 10 === 0) {
                notice.setMessage(`${label}... (${i + 1}/${markdownFiles.length})`);
            }

            try {
                const images = await this.finder.findInFile(file);
                for (const image of images) {
                    if (image.exists) {
                        paths.add(image.absolutePath);
                    }
                }
            } catch (err) {
                errorCount++;
                this.logger.warn(`Failed to scan note: ${file.path}`, err);
            }
        }

        return {paths, errorCount};
    }

    private async waitForTerminalTasks(tasks: UploadTask[], notice: Notice, label: string): Promise<void> {
        if (tasks.length === 0) {
            return;
        }

        const targetTaskIds = new Set(tasks.map(t => t.id));
        const terminalTaskIds = new Set<string>();

        const updateNotice = () => {
            notice.setMessage(`${label}... (${terminalTaskIds.size}/${targetTaskIds.size})`);
        };

        // Initialize state from current task objects in case some tasks already completed
        // before we attach event listeners.
        for (const task of tasks) {
            if (isTerminalStatus(task.status)) {
                terminalTaskIds.add(task.id);
            }
        }
        updateNotice();

        const onTerminal = (task: UploadTask) => {
            if (!targetTaskIds.has(task.id)) return;
            terminalTaskIds.add(task.id);
            updateNotice();
        };

        this.uploadManager.on(UploadManager.EVENTS.TASK_COMPLETED, onTerminal);
        this.uploadManager.on(UploadManager.EVENTS.TASK_FAILED, onTerminal);
        this.uploadManager.on(UploadManager.EVENTS.TASK_CANCELLED, onTerminal);

        let interval: NodeJS.Timeout | null = null;
        try {
            await new Promise<void>((resolve) => {
                if (terminalTaskIds.size >= targetTaskIds.size) {
                    resolve();
                    return;
                }

                // Polling is a safety net: event delivery can be missed in edge cases,
                // and tasks are mutated in-place, so polling remains consistent.
                interval = setInterval(() => {
                    for (const task of tasks) {
                        if (isTerminalStatus(task.status)) {
                            terminalTaskIds.add(task.id);
                        }
                    }
                    if (terminalTaskIds.size >= targetTaskIds.size) {
                        resolve();
                    }
                }, 250);
            });
        } finally {
            if (interval) {
                clearInterval(interval);
            }
            this.uploadManager.off(UploadManager.EVENTS.TASK_COMPLETED, onTerminal);
            this.uploadManager.off(UploadManager.EVENTS.TASK_FAILED, onTerminal);
            this.uploadManager.off(UploadManager.EVENTS.TASK_CANCELLED, onTerminal);
        }
    }

    private getCompletedTasksForPaths(targetPaths: Set<string>): UploadTask[] {
        const tasks = this.uploadManager
            .getAllTasks()
            .filter(t => t.status === 'completed' && !!t.url && targetPaths.has(t.filePath));
        return tasks;
    }

    private buildReplacementMap(tasks: UploadTask[]): Record<string, string> {
        const replacements: Record<string, string> = {};
        for (const task of tasks) {
            if (task.url) {
                replacements[task.filePath] = task.url;
            }
        }
        return replacements;
    }

    private async rewriteLinks(
        markdownFiles: TFile[],
        replacements: Record<string, string>,
        notice: Notice
    ): Promise<{modifiedNotes: number; replacedLinks: number}> {
        let modifiedNotes = 0;
        let replacedLinks = 0;

        if (Object.keys(replacements).length === 0) {
            return {modifiedNotes, replacedLinks};
        }

        for (let i = 0; i < markdownFiles.length; i++) {
            const file = markdownFiles[i];
            if (i % 10 === 0) {
                notice.setMessage(`正在替换笔记中的图片链接... (${i + 1}/${markdownFiles.length})`);
            }

            try {
                // cachedRead avoids disk churn during full-vault operations.
                // In the worst case, stale cache yields fewer deletions (safe failure), not data loss.
                const content = await this.app.vault.cachedRead(file);
                const result = await this.updater.updateLinks(content, file.path, replacements);
                if (!result.modified) {
                    continue;
                }

                await this.app.vault.modify(file, result.content);
                modifiedNotes++;
                replacedLinks += result.replacedCount;
            } catch (err) {
                this.logger.warn(`Failed to update note: ${file.path}`, err);
            }
        }

        return {modifiedNotes, replacedLinks};
    }

    private async deleteLocalFiles(
        filePaths: string[],
        notice: Notice
    ): Promise<{deletedCount: number; errorCount: number}> {
        let deletedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            if (i % 10 === 0) {
                notice.setMessage(`正在删除本地文件... (${i + 1}/${filePaths.length})`);
            }

            try {
                const exists = await this.app.vault.adapter.exists(filePath);
                if (!exists) {
                    this.logger.debug(`File already deleted: ${filePath}`);
                    continue;
                }
                await this.app.vault.adapter.remove(filePath);
                deletedCount++;
            } catch (err) {
                errorCount++;
                this.logger.warn(`Failed to delete local file: ${filePath}`, err);
            }
        }

        return {deletedCount, errorCount};
    }

    private summarizeTasks(tasks: UploadTask[]): {failed: number; cancelled: number} {
        let failed = 0;
        let cancelled = 0;

        for (const task of tasks) {
            if (task.status === 'failed') failed++;
            if (task.status === 'cancelled') cancelled++;
        }

        return {failed, cancelled};
    }
}
