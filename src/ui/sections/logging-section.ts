/**
 * LoggingSection - Log and notification settings
 */

import {BaseSection} from './base-section';
import {createToggleInput} from '../helpers';

export class LoggingSection extends BaseSection {
    public render(container: HTMLElement): void {
        this.createHeading(container, '日志设置');

        // Detailed logs toggle
        createToggleInput(container, {
            name: '显示详细日志',
            desc: '在控制台输出详细的调试日志',
            getValue: () => this.settings.showDetailedLogs || false,
            setValue: async (value) => {
                this.settings.showDetailedLogs = value;
                await this.save();
            }
        });

        // Progress notifications toggle
        createToggleInput(container, {
            name: '显示上传进度通知',
            desc: '显示文件上传进度的通知',
            getValue: () => this.settings.showProgressNotifications ?? true,
            setValue: async (value) => {
                this.settings.showProgressNotifications = value;
                await this.save();
            }
        });
    }
}
