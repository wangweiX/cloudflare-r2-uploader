/**
 * BaseSection - Abstract base class for settings sections
 */

import {PluginSettings} from '../../types';

/**
 * Interface for settings section dependencies
 */
export interface SectionDeps {
    getSettings: () => PluginSettings;
    saveSettings: () => Promise<void>;
}

/**
 * Abstract base class for settings sections
 */
export abstract class BaseSection {
    constructor(protected readonly deps: SectionDeps) {}

    /**
     * Get current settings
     */
    protected get settings(): PluginSettings {
        return this.deps.getSettings();
    }

    /**
     * Save settings
     */
    protected async save(): Promise<void> {
        await this.deps.saveSettings();
    }

    /**
     * Render the section into the container
     */
    public abstract render(container: HTMLElement): void;

    /**
     * Create a section heading
     */
    protected createHeading(container: HTMLElement, text: string): HTMLElement {
        return container.createEl('h2', {text});
    }

    /**
     * Create a horizontal rule
     */
    protected createDivider(container: HTMLElement): HTMLElement {
        return container.createEl('hr');
    }

    /**
     * Create a description div
     */
    protected createDescription(container: HTMLElement): HTMLDivElement {
        return container.createDiv({cls: 'setting-item-description'});
    }
}
