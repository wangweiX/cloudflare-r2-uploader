/**
 * AdvancedSection - Concurrency, retry, and timeout settings
 */

import {BaseSection} from './base-section';
import {createNumericInput} from '../helpers';

export class AdvancedSection extends BaseSection {
    public render(container: HTMLElement): void {
        this.createHeading(container, '高级设置');

        // Max concurrent uploads
        createNumericInput(container, {
            name: '最大并发上传数',
            desc: '同时上传的最大文件数量（1-50）',
            placeholder: '3',
            min: 1,
            max: 50,
            getValue: () => this.settings.maxConcurrentUploads || 3,
            setValue: async (value) => {
                this.settings.maxConcurrentUploads = value;
                await this.save();
            }
        });

        // Max retries
        createNumericInput(container, {
            name: '最大重试次数',
            desc: '上传失败时的最大重试次数（0-5）',
            placeholder: '3',
            min: 0,
            max: 5,
            getValue: () => this.settings.maxRetries || 3,
            setValue: async (value) => {
                this.settings.maxRetries = value;
                await this.save();
            }
        });

        // Retry delay
        createNumericInput(container, {
            name: '重试延迟（毫秒）',
            desc: '首次重试前的等待时间（100-10000）',
            placeholder: '1000',
            min: 100,
            max: 10000,
            getValue: () => this.settings.retryDelay || 1000,
            setValue: async (value) => {
                this.settings.retryDelay = value;
                await this.save();
            }
        });

        // Max retry delay
        createNumericInput(container, {
            name: '最大重试延迟（毫秒）',
            desc: '指数退避的最大延迟上限（1000-60000）',
            placeholder: '30000',
            min: 1000,
            max: 60000,
            getValue: () => this.settings.maxRetryDelay || 30000,
            setValue: async (value) => {
                this.settings.maxRetryDelay = value;
                await this.save();
            }
        });

        // Upload timeout
        createNumericInput(container, {
            name: '上传超时（毫秒）',
            desc: '单个文件上传的超时时间（10000-300000）',
            placeholder: '60000',
            min: 10000,
            max: 300000,
            getValue: () => this.settings.uploadTimeout || 60000,
            setValue: async (value) => {
                this.settings.uploadTimeout = value;
                await this.save();
            }
        });
    }
}
