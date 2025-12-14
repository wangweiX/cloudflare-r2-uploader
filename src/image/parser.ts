/**
 * ImageLinkParser - Pure string parsing for image links in markdown
 *
 * Responsibilities:
 * - Parse markdown content for image links
 * - Support both standard markdown ![alt](path) and Obsidian ![[path]] formats
 * - Handle edge cases: |alias, "title", <angle brackets>, #headings
 * - Classify links as local or remote
 *
 * This is a pure utility class with no external dependencies.
 */

import {IMAGE_PATTERNS, MIME_TYPES} from '../config';
import {ParsedImageLink} from './types';

/**
 * Supported image extensions derived from `MIME_TYPES`.
 *
 * This is used to filter out non-image embeds/links from regex parsing results.
 */
const supportedImageExtensions = new Set(Object.keys(MIME_TYPES));

export class ImageLinkParser {
    /**
     * Extract a lowercase extension from a path, ignoring query and fragment parts.
     *
     * Examples:
     * - `foo/bar.png` -> `png`
     * - `bar.JPG?x=1` -> `jpg`
     * - `noext` -> ``
     */
    private getImageExtension(path: string): string {
        const withoutQueryOrFragment = path.split(/[?#]/, 1)[0];
        const normalized = withoutQueryOrFragment.replace(/\\/g, '/');
        const lastSlash = normalized.lastIndexOf('/');
        const filename = lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1);
        const dotIndex = filename.lastIndexOf('.');
        if (dotIndex <= 0 || dotIndex === filename.length - 1) {
            return '';
        }
        return filename.substring(dotIndex + 1).toLowerCase();
    }

    /**
     * Check whether a link destination should be treated as an image based on file extension.
     *
     * This is applied only to local links; remote URLs are allowed even when the extension
     * is missing (e.g. `https://example.com/image?id=123`).
     */
    private isSupportedImagePath(path: string): boolean {
        const ext = this.getImageExtension(path);
        return ext.length > 0 && supportedImageExtensions.has(ext);
    }

    /**
     * Parse content and extract all image links
     *
     * @param content Markdown content to parse
     * @returns Array of parsed image links with metadata
     */
    public parse(content: string): ParsedImageLink[] {
        const links: ParsedImageLink[] = [];

        // Parse standard markdown format: ![alt](path)
        this.parseStandardFormat(content, links);

        // Parse Obsidian internal format: ![[path]]
        this.parseObsidianFormat(content, links);

        // Sort by index for consistent ordering
        links.sort((a, b) => a.index - b.index);

        return links;
    }

    /**
     * Parse only local (non-remote) image links
     *
     * @param content Markdown content to parse
     * @returns Array of local image links
     */
    public parseLocalImages(content: string): ParsedImageLink[] {
        return this.parse(content).filter(link => !link.isRemote);
    }

    /**
     * Check if a path is a remote URL
     */
    public isRemoteUrl(path: string): boolean {
        return path.startsWith('http://') || path.startsWith('https://');
    }

    /**
     * Parse standard markdown image format: ![alt](path)
     *
     * Handles:
     * - Basic: ![alt](path)
     * - With title: ![alt](path "title")
     * - With angle brackets: ![alt](<path with spaces.png>)
     * - Combined: ![alt](<path> "title")
     */
    private parseStandardFormat(content: string, links: ParsedImageLink[]): void {
        // Create new regex instance to avoid lastIndex issues
        const regex = new RegExp(IMAGE_PATTERNS.STANDARD_MARKDOWN.source, 'g');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
            const fullMatch = match[0];
            const altText = match[1];
            const rawDestination = match[2];

            // Normalize the destination (handle <>, title, etc.)
            const {path, title} = this.parseStandardDestination(rawDestination);

            const isRemote = this.isRemoteUrl(path);
            const link: ParsedImageLink = {
                fullMatch,
                index: match.index,
                length: fullMatch.length,
                format: 'standard',
                altText,
                path,
                isRemote
            };

            if (!isRemote && !this.isSupportedImagePath(path)) {
                continue;
            }

            if (title) {
                link.title = title;
            }

            links.push(link);
        }
    }

    /**
     * Parse the destination part of a standard markdown image link
     *
     * Markdown spec allows:
     * - <url> (angle brackets, allows spaces)
     * - url (no brackets, ends at whitespace)
     * - Followed by optional "title" or 'title' or (title)
     */
    private parseStandardDestination(raw: string): {path: string; title?: string} {
        const trimmed = raw.trim();

        // Case 1: Angle brackets <path>
        if (trimmed.startsWith('<')) {
            const closeIndex = trimmed.indexOf('>');
            if (closeIndex !== -1) {
                const path = trimmed.substring(1, closeIndex);
                const rest = trimmed.substring(closeIndex + 1).trim();
                const title = this.extractTitle(rest);
                return {path, title};
            }
        }

        // Case 2: No angle brackets - path ends at whitespace
        // Match: path followed by optional whitespace and title
        const spaceIndex = trimmed.search(/\s/);
        if (spaceIndex === -1) {
            // No whitespace, entire string is the path
            return {path: trimmed};
        }

        const path = trimmed.substring(0, spaceIndex);
        const rest = trimmed.substring(spaceIndex).trim();
        const title = this.extractTitle(rest);
        return {path, title};
    }

    /**
     * Extract title from the rest of the destination string
     * Title can be in "quotes", 'quotes', or (parentheses)
     */
    private extractTitle(rest: string): string | undefined {
        if (!rest) return undefined;

        // Match "title", 'title', or (title)
        const match = rest.match(/^["'(](.*)["')]$/);
        if (match) {
            return match[1];
        }

        // Try matching just the opening quote/paren
        if (rest.startsWith('"') || rest.startsWith("'")) {
            const quote = rest[0];
            const endIndex = rest.lastIndexOf(quote);
            if (endIndex > 0) {
                return rest.substring(1, endIndex);
            }
        }

        if (rest.startsWith('(')) {
            const endIndex = rest.lastIndexOf(')');
            if (endIndex > 0) {
                return rest.substring(1, endIndex);
            }
        }

        return undefined;
    }

    /**
     * Parse Obsidian internal image format: ![[path]]
     *
     * Handles:
     * - Basic: ![[image.png]]
     * - With alias/size: ![[image.png|100]] or ![[image.png|alt text]]
     * - With heading: ![[image.png#section]] (strip the heading part)
     * - Combined: ![[folder/image.png|100]]
     */
    private parseObsidianFormat(content: string, links: ParsedImageLink[]): void {
        // Create new regex instance to avoid lastIndex issues
        const regex = new RegExp(IMAGE_PATTERNS.OBSIDIAN_INTERNAL.source, 'g');
        let match: RegExpExecArray | null;

        while ((match = regex.exec(content)) !== null) {
            const fullMatch = match[0];
            const rawPath = match[1];

            // Normalize the path (handle |alias, #heading, etc.)
            const {path, alias} = this.parseObsidianPath(rawPath);

            const link: ParsedImageLink = {
                fullMatch,
                index: match.index,
                length: fullMatch.length,
                format: 'obsidian',
                altText: '', // Obsidian format doesn't have explicit alt text
                path,
                isRemote: false // Obsidian internal links are never remote
            };

            if (!this.isSupportedImagePath(path)) {
                continue;
            }

            if (alias) {
                link.obsidianAlias = alias;
            }

            links.push(link);
        }
    }

    /**
     * Parse Obsidian path to extract the actual file path
     *
     * Format: path[#heading][|alias]
     * Examples:
     * - image.png -> {path: "image.png"}
     * - image.png|100 -> {path: "image.png", alias: "100"}
     * - image.png#section -> {path: "image.png"}
     * - image.png#section|alt -> {path: "image.png", alias: "alt"}
     */
    private parseObsidianPath(raw: string): {path: string; alias?: string} {
        let path = raw;
        let alias: string | undefined;

        // First, handle | (alias/size) - comes after #heading if both present
        const pipeIndex = path.indexOf('|');
        if (pipeIndex !== -1) {
            alias = path.substring(pipeIndex + 1);
            path = path.substring(0, pipeIndex);
        }

        // Then, strip # (heading anchor) - we only care about the file path
        const hashIndex = path.indexOf('#');
        if (hashIndex !== -1) {
            path = path.substring(0, hashIndex);
        }

        return {path: path.trim(), alias: alias?.trim()};
    }
}
