/**
 * 日志工具类
 * 提供统一的日志记录功能，支持控制台输出和 Obsidian 通知
 */

import { Notice } from 'obsidian';

/**
 * 日志级别
 */
export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

/**
 * 日志配置
 */
interface LoggerConfig {
    level: LogLevel;
    showDetailedLogs: boolean;
    showProgressNotifications: boolean;
    prefix: string;
}

/**
 * 日志格式化选项
 */
interface LogFormatOptions {
    timestamp?: boolean;
    level?: boolean;
    category?: string;
}

/**
 * 日志记录器
 */
export class Logger {
    private static instance: Logger;
    private config: LoggerConfig;
    private noticeQueue: Notice[] = [];
    private maxQueueSize = 3;

    private constructor() {
        this.config = {
            level: LogLevel.INFO,
            showDetailedLogs: false,
            showProgressNotifications: true,
            prefix: 'Cloudflare R2 Uploader'
        };
    }

    /**
     * 获取单例实例
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * 更新配置
     */
    public updateConfig(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * 设置日志级别
     */
    public setLevel(level: LogLevel): void {
        this.config.level = level;
    }

    /**
     * 设置日志级别（兼容旧API）
     */
    public setLogLevel(level: LogLevel): void {
        this.setLevel(level);
    }

    /**
     * 设置是否显示详细日志
     */
    public setShowDetailedLogs(show: boolean): void {
        this.config.showDetailedLogs = show;
    }

    /**
     * 设置是否显示进度通知
     */
    public setShowProgressNotifications(show: boolean): void {
        this.config.showProgressNotifications = show;
    }

    /**
     * 调试日志
     */
    public debug(message: string, ...args: any[]): void {
        this.log(LogLevel.DEBUG, message, args);
    }

    /**
     * 信息日志
     */
    public info(message: string, ...args: any[]): void {
        this.log(LogLevel.INFO, message, args);
    }

    /**
     * 警告日志
     */
    public warn(message: string, ...args: any[]): void {
        this.log(LogLevel.WARN, message, args);
    }

    /**
     * 错误日志
     */
    public error(message: string, error?: any, ...args: any[]): void {
        if (error) {
            this.log(LogLevel.ERROR, message, [error, ...args]);
            if (error instanceof Error) {
                this.log(LogLevel.ERROR, `错误详情: ${error.message}`, [error.stack]);
            }
        } else {
            this.log(LogLevel.ERROR, message, args);
        }
    }

    /**
     * 显示通知
     */
    public notify(message: string, timeout = 5000, type: 'info' | 'error' | 'progress' = 'info'): Notice {
        // 如果是进度通知，检查配置
        if (type === 'progress' && !this.config.showProgressNotifications) {
            return new Notice(''); // 返回一个空通知
        }

        // 清理旧的通知队列
        this.cleanNoticeQueue();

        // 根据类型格式化消息
        const formattedMessage = this.formatNoticeMessage(message, type);
        
        // 创建新通知
        const notice = new Notice(formattedMessage, timeout);
        
        // 添加到队列
        if (timeout > 0) {
            this.noticeQueue.push(notice);
        }
        
        return notice;
    }

    /**
     * 显示进度通知
     */
    public notifyProgress(message: string, timeout = 2000): Notice {
        return this.notify(message, timeout, 'progress');
    }

    /**
     * 显示错误通知
     */
    public notifyError(message: string, timeout = 5000): Notice {
        return this.notify(message, timeout, 'error');
    }

    /**
     * 记录日志
     */
    private log(level: LogLevel, message: string, args: any[]): void {
        // 检查日志级别
        if (level < this.config.level) {
            return;
        }

        // 如果不显示详细日志，只记录警告和错误
        if (!this.config.showDetailedLogs && level < LogLevel.WARN) {
            return;
        }

        // 格式化消息
        const formattedMessage = this.formatLogMessage(message, {
            timestamp: true,
            level: true
        });

        // 输出到控制台
        switch (level) {
            case LogLevel.DEBUG:
                console.debug(formattedMessage, ...args);
                break;
            case LogLevel.INFO:
                console.info(formattedMessage, ...args);
                break;
            case LogLevel.WARN:
                console.warn(formattedMessage, ...args);
                break;
            case LogLevel.ERROR:
                console.error(formattedMessage, ...args);
                break;
        }
    }

    /**
     * 格式化日志消息
     */
    private formatLogMessage(message: string, options: LogFormatOptions): string {
        const parts: string[] = [];

        // 添加时间戳
        if (options.timestamp) {
            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
            parts.push(`[${timestamp}]`);
        }

        // 添加日志级别
        if (options.level) {
            const levelName = LogLevel[this.config.level];
            parts.push(`[${levelName}]`);
        }

        // 添加前缀
        parts.push(`[${this.config.prefix}]`);

        // 添加分类
        if (options.category) {
            parts.push(`[${options.category}]`);
        }

        // 添加消息
        parts.push(message);

        return parts.join(' ');
    }

    /**
     * 格式化通知消息
     */
    private formatNoticeMessage(message: string, type: 'info' | 'error' | 'progress'): string {
        const prefix = {
            info: '💡',
            error: '❌',
            progress: '⏳'
        };

        return `${prefix[type]} ${this.config.prefix}: ${message}`;
    }

    /**
     * 清理通知队列
     */
    private cleanNoticeQueue(): void {
        // 保持队列大小在限制内
        while (this.noticeQueue.length >= this.maxQueueSize) {
            const oldNotice = this.noticeQueue.shift();
            if (oldNotice) {
                oldNotice.hide();
            }
        }

        // 移除已经隐藏的通知
        this.noticeQueue = this.noticeQueue.filter(notice => {
            // Notice 类没有直接的方法检查是否已隐藏
            // 这里简单地保留所有通知
            return true;
        });
    }

    /**
     * 清除所有通知
     */
    public clearAllNotices(): void {
        this.noticeQueue.forEach(notice => notice.hide());
        this.noticeQueue = [];
    }

    /**
     * 创建一个带分类的日志器
     */
    public createCategoryLogger(category: string): CategoryLogger {
        return new CategoryLogger(this, category);
    }
}

/**
 * 分类日志器
 */
export class CategoryLogger {
    constructor(
        private logger: Logger,
        private category: string
    ) {}

    public debug(message: string, ...args: any[]): void {
        this.logger.debug(`[${this.category}] ${message}`, ...args);
    }

    public info(message: string, ...args: any[]): void {
        this.logger.info(`[${this.category}] ${message}`, ...args);
    }

    public warn(message: string, ...args: any[]): void {
        this.logger.warn(`[${this.category}] ${message}`, ...args);
    }

    public error(message: string, error?: any, ...args: any[]): void {
        this.logger.error(`[${this.category}] ${message}`, error, ...args);
    }
}