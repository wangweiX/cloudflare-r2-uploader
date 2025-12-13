/**
 * Setting Helpers - Reusable UI helpers for settings
 */

import {Setting} from 'obsidian';

/**
 * Configuration for a password input field
 */
export interface PasswordInputConfig {
    name: string;
    desc: string;
    placeholder: string;
    getValue: () => string;
    setValue: (value: string) => Promise<void>;
}

/**
 * Configuration for a text input field
 */
export interface TextInputConfig {
    name: string;
    desc: string;
    placeholder: string;
    getValue: () => string;
    setValue: (value: string) => Promise<void>;
}

/**
 * Configuration for a numeric input field
 */
export interface NumericInputConfig {
    name: string;
    desc: string;
    placeholder: string;
    min: number;
    max: number;
    getValue: () => number;
    setValue: (value: number) => Promise<void>;
}

/**
 * Configuration for a toggle input field
 */
export interface ToggleInputConfig {
    name: string;
    desc: string;
    getValue: () => boolean;
    setValue: (value: boolean) => Promise<void>;
}

/**
 * Create a password input setting
 */
export function createPasswordInput(
    container: HTMLElement,
    config: PasswordInputConfig
): Setting {
    return new Setting(container)
        .setName(config.name)
        .setDesc(config.desc)
        .addText(text => {
            text.inputEl.type = 'password';
            text.inputEl.autocomplete = 'off';
            text.setPlaceholder(config.placeholder)
                .setValue(config.getValue())
                .onChange(async (value) => {
                    await config.setValue(value.trim());
                });
        });
}

/**
 * Create a text input setting
 */
export function createTextInput(
    container: HTMLElement,
    config: TextInputConfig
): Setting {
    return new Setting(container)
        .setName(config.name)
        .setDesc(config.desc)
        .addText(text => text
            .setPlaceholder(config.placeholder)
            .setValue(config.getValue())
            .onChange(async (value) => {
                await config.setValue(value.trim());
            }));
}

/**
 * Create a numeric input setting with validation
 */
export function createNumericInput(
    container: HTMLElement,
    config: NumericInputConfig
): Setting {
    return new Setting(container)
        .setName(config.name)
        .setDesc(config.desc)
        .addText(text => text
            .setPlaceholder(config.placeholder)
            .setValue(String(config.getValue()))
            .onChange(async (value) => {
                const num = parseInt(value);
                if (!isNaN(num) && num >= config.min && num <= config.max) {
                    await config.setValue(num);
                }
            }));
}

/**
 * Create a toggle setting
 */
export function createToggleInput(
    container: HTMLElement,
    config: ToggleInputConfig
): Setting {
    return new Setting(container)
        .setName(config.name)
        .setDesc(config.desc)
        .addToggle(toggle => {
            toggle
                .setValue(config.getValue())
                .onChange(async (value) => {
                    await config.setValue(value);
                });
        });
}
