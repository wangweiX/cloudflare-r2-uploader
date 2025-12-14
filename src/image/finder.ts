/**
 * ImageFinder - Find and resolve images in markdown files
 *
 * Responsibilities:
 * - Find images in file content or entire vault
 * - Resolve relative paths to absolute paths
 * - Validate file existence and get file stats
 *
 * Dependencies:
 * - ImageLinkParser for parsing
 * - Obsidian's DataAdapter for file operations
 */

import {App, DataAdapter, TFile} from 'obsidian';
import {resolveAbsolutePath, type LinkpathResolver} from '../utils';
import {ImageLinkParser} from './parser';
import {ParsedImageLink, ResolvedImage} from './types';

/**
 * Options for image finding operations
 */
export interface FinderOptions {
    /** Whether to include images that don't exist */
    includeNonExistent?: boolean;
}

export class ImageFinder {
    private readonly parser: ImageLinkParser;
    /**
     * Resolver powered by Obsidian's metadata cache.
     *
     * This matches Obsidian's own link resolution behavior (including resolving
     * filename-only links across the entire vault).
     */
    private readonly linkpathResolver: LinkpathResolver;

    constructor(
        private readonly app: App,
        private readonly adapter: DataAdapter
    ) {
        this.parser = new ImageLinkParser();
        this.linkpathResolver = (linkpath, sourcePath) =>
            this.app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
    }

    /**
     * Find all local images in file content
     *
     * @param content Markdown content
     * @param basePath Path of the file (for resolving relative paths)
     * @param options Finder options
     * @returns Array of resolved images
     */
    public async findInContent(
        content: string,
        basePath: string,
        options: FinderOptions = {}
    ): Promise<ResolvedImage[]> {
        const links = this.parser.parseLocalImages(content);
        return this.resolveImages(links, basePath, options);
    }

    /**
     * Find all local images in a file
     *
     * @param file The markdown file to search
     * @param options Finder options
     * @returns Array of resolved images
     */
    public async findInFile(
        file: TFile,
        options: FinderOptions = {}
    ): Promise<ResolvedImage[]> {
        const content = await this.app.vault.cachedRead(file);
        return this.findInContent(content, file.path, options);
    }

    /**
     * Resolve parsed image links to absolute paths with existence check
     */
    private async resolveImages(
        links: ParsedImageLink[],
        basePath: string,
        options: FinderOptions
    ): Promise<ResolvedImage[]> {
        const results: ResolvedImage[] = [];
        const seenPaths = new Set<string>();

        for (const link of links) {
            const absolutePath = await resolveAbsolutePath(basePath, link.path, this.adapter, this.linkpathResolver);

            if (!absolutePath) {
                if (options.includeNonExistent) {
                    results.push({
                        originalPath: link.path,
                        absolutePath: '',
                        exists: false
                    });
                }
                continue;
            }

            // Skip duplicates
            if (seenPaths.has(absolutePath)) {
                continue;
            }
            seenPaths.add(absolutePath);

            // Check existence and get stats
            const exists = await this.adapter.exists(absolutePath);

            if (!exists && !options.includeNonExistent) {
                continue;
            }

            const resolved: ResolvedImage = {
                originalPath: link.path,
                absolutePath,
                exists
            };

            // Get file size if exists
            if (exists) {
                const stat = await this.adapter.stat(absolutePath);
                if (stat) {
                    resolved.size = stat.size;
                }
            }

            results.push(resolved);
        }

        return results;
    }
}
