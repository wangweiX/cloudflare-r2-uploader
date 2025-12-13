/**
 * LinkUpdater - Replace image links in markdown content
 *
 * Responsibilities:
 * - Replace local image paths with cloud URLs
 * - Handle both standard markdown and Obsidian formats
 * - Convert Obsidian ![[path]] to standard ![alt](url) after upload
 *
 * Dependencies:
 * - ImageLinkParser for parsing
 * - Path resolution for matching original paths to replacements
 */

import {DataAdapter} from 'obsidian';
import {resolveAbsolutePath, posixBasename, posixExtname} from '../utils';
import {ImageLinkParser} from './parser';
import {LinkUpdateResult, ParsedImageLink} from './types';

/**
 * Mapping of absolute paths to new URLs
 */
export type ReplacementMap = Record<string, string>;

export class LinkUpdater {
    private readonly parser: ImageLinkParser;

    constructor(private readonly adapter: DataAdapter) {
        this.parser = new ImageLinkParser();
    }

    /**
     * Update image links in content with new URLs
     *
     * @param content Original markdown content
     * @param basePath Path of the file (for resolving relative paths)
     * @param replacements Map of absolute paths to new URLs
     * @returns Updated content and stats
     */
    public async updateLinks(
        content: string,
        basePath: string,
        replacements: ReplacementMap
    ): Promise<LinkUpdateResult> {
        if (Object.keys(replacements).length === 0) {
            return {content, replacedCount: 0, modified: false};
        }

        const links = this.parser.parseLocalImages(content);

        if (links.length === 0) {
            return {content, replacedCount: 0, modified: false};
        }

        // Build replacement info for each link
        const replacementInfo = await this.buildReplacementInfo(links, basePath, replacements);

        // Apply replacements in reverse order to preserve indices
        let newContent = content;
        let replacedCount = 0;

        // Sort by index descending for safe replacement
        const sortedInfo = [...replacementInfo].sort((a, b) => b.link.index - a.link.index);

        for (const {link, newUrl} of sortedInfo) {
            if (!newUrl) continue;

            const replacement = this.buildReplacement(link, newUrl);
            newContent =
                newContent.substring(0, link.index) +
                replacement +
                newContent.substring(link.index + link.length);

            replacedCount++;
        }

        return {
            content: newContent,
            replacedCount,
            modified: replacedCount > 0
        };
    }

    /**
     * Build replacement info for each link
     */
    private async buildReplacementInfo(
        links: ParsedImageLink[],
        basePath: string,
        replacements: ReplacementMap
    ): Promise<Array<{link: ParsedImageLink; newUrl: string | null}>> {
        const result: Array<{link: ParsedImageLink; newUrl: string | null}> = [];

        for (const link of links) {
            const absolutePath = await resolveAbsolutePath(basePath, link.path, this.adapter);

            if (!absolutePath) {
                result.push({link, newUrl: null});
                continue;
            }

            const newUrl = replacements[absolutePath] || null;
            result.push({link, newUrl});
        }

        return result;
    }

    /**
     * Build replacement string for a link
     *
     * Standard format: ![alt](path) -> ![alt](newUrl) or ![alt](newUrl "title")
     * Obsidian format: ![[path]] or ![[path|alias]] -> ![alias or filename](newUrl)
     */
    private buildReplacement(link: ParsedImageLink, newUrl: string): string {
        if (link.format === 'standard') {
            // Preserve title if it exists (more diff-friendly)
            if (link.title) {
                return `![${link.altText}](${newUrl} "${link.title}")`;
            }
            return `![${link.altText}](${newUrl})`;
        }

        // Obsidian format: use alias if present, otherwise use filename without extension
        let altText: string;
        if (link.obsidianAlias) {
            // If alias is just a number (resize), use filename instead
            if (/^\d+$/.test(link.obsidianAlias)) {
                altText = posixBasename(link.path, posixExtname(link.path));
            } else {
                altText = link.obsidianAlias;
            }
        } else {
            altText = posixBasename(link.path, posixExtname(link.path));
        }

        return `![${altText}](${newUrl})`;
    }
}
