/**
 * Image module type definitions
 */

/**
 * Parsed image link from markdown content
 */
export interface ParsedImageLink {
    /** Full matched string (e.g., "![alt](path)" or "![[path]]") */
    fullMatch: string;
    /** Start index in the content */
    index: number;
    /** Length of the full match */
    length: number;
    /** Link format type */
    format: 'standard' | 'obsidian';
    /** Alt text (empty string for obsidian format) */
    altText: string;
    /** Image path (relative or absolute), normalized (without |alias, "title", etc.) */
    path: string;
    /** Whether the path is a remote URL */
    isRemote: boolean;
    /** For Obsidian format: alias or size after | (e.g., "100" or "alt text") */
    obsidianAlias?: string;
    /** For standard format: title after path (e.g., "my title") */
    title?: string;
}

/**
 * Resolved image with absolute path and validation
 */
export interface ResolvedImage {
    /** Original path from markdown */
    originalPath: string;
    /** Resolved absolute path in vault */
    absolutePath: string;
    /** Whether the file exists */
    exists: boolean;
    /** File size in bytes (if exists) */
    size?: number;
}

/**
 * Result of link update operation
 */
export interface LinkUpdateResult {
    /** Updated content */
    content: string;
    /** Number of links replaced */
    replacedCount: number;
    /** Whether content was modified */
    modified: boolean;
}
