import {v4 as uuidv4} from 'uuid';
import {MIME_TYPES} from '../config';

/**
 * Generate a unique, sanitized file name.
 */
export function generateUniqueFileName(originalName: string): string {
    const ext = posixExtname(originalName);
    const baseName = posixBasename(originalName, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_.-]/g, '_');
    const timestamp = Date.now();
    const randomId = uuidv4().split('-')[0];
    return `${baseName}_${timestamp}_${randomId}${ext}`;
}

/**
 * Normalize a path to use POSIX separators (forward slashes).
 * Obsidian vault paths always use forward slashes regardless of platform.
 * Also resolves . and .. path segments.
 */
function normalizeVaultPath(p: string): string {
    // Replace backslashes with forward slashes
    let normalized = p.replace(/\\/g, '/');
    // Remove redundant slashes
    normalized = normalized.replace(/\/+/g, '/');
    // Remove leading ./ if present
    if (normalized.startsWith('./')) {
        normalized = normalized.substring(2);
    }
    // Remove trailing slash
    if (normalized.endsWith('/') && normalized.length > 1) {
        normalized = normalized.slice(0, -1);
    }

    const isAbsolute = normalized.startsWith('/');

    // Resolve . and .. segments using stack-based approach
    const parts = normalized.split('/');
    const stack: string[] = [];

    for (const part of parts) {
        if (part === '' || part === '.') {
            // Skip empty parts and current directory references
            continue;
        } else if (part === '..') {
            // Go up one directory if possible
            if (stack.length > 0 && stack[stack.length - 1] !== '..') {
                stack.pop();
            }
            // If this is an absolute vault path, do not allow going above root.
            // For relative paths, preserve leading ".." so that baseDir joining can resolve it correctly.
            else if (!isAbsolute) {
                stack.push('..');
            }
        } else {
            stack.push(part);
        }
    }

    const result = stack.join('/');
    return isAbsolute ? `/${result}` : result;
}

/**
 * Get the directory name using POSIX-style paths.
 */
function posixDirname(p: string): string {
    const normalized = normalizeVaultPath(p);
    const lastSlash = normalized.lastIndexOf('/');
    if (lastSlash === -1) return '';
    return normalized.substring(0, lastSlash);
}

/**
 * Join paths using POSIX-style paths.
 */
function posixJoin(...parts: string[]): string {
    const joined = parts
        .filter(p => p && p.length > 0)
        .map(p => normalizeVaultPath(p))
        .join('/');
    return normalizeVaultPath(joined);
}

/**
 * Get file extension using POSIX-style paths.
 * Returns extension with dot (e.g., ".png") or empty string if none.
 */
export function posixExtname(p: string): string {
    const normalized = normalizeVaultPath(p);
    const lastSlash = normalized.lastIndexOf('/');
    const filename = lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1);
    const dotIndex = filename.lastIndexOf('.');
    // No dot, or dot is first char (hidden file), or dot is last char
    if (dotIndex <= 0 || dotIndex === filename.length - 1) {
        return '';
    }
    return filename.substring(dotIndex);
}

/**
 * Get base filename using POSIX-style paths.
 * If ext is provided, it will be stripped from the result.
 */
export function posixBasename(p: string, ext?: string): string {
    const normalized = normalizeVaultPath(p);
    const lastSlash = normalized.lastIndexOf('/');
    let filename = lastSlash === -1 ? normalized : normalized.substring(lastSlash + 1);
    if (ext && filename.endsWith(ext)) {
        filename = filename.substring(0, filename.length - ext.length);
    }
    return filename;
}

/**
 * Minimal shape of Obsidian's `ListedFiles` result from `DataAdapter.list()`.
 *
 * Keeping this local avoids a hard dependency on Obsidian types in the utils layer.
 */
type ListedFiles = {files: string[]; folders: string[]};

/**
 * Minimal adapter surface required by `resolveAbsolutePath`.
 *
 * - `exists()` is required for fast checks.
 * - `list()` is optional and only used for the vault-wide filename fallback.
 */
type VaultLikeAdapter = {
    exists: (p: string) => Promise<boolean>;
    list?: (p: string) => Promise<ListedFiles>;
};

/**
 * Optional resolver that mimics Obsidian's internal link resolution behavior.
 *
 * A typical implementation is:
 * `app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath)`
 *
 * This resolver is used to support filename-only references that Obsidian can resolve across the vault.
 */
export type LinkpathResolver = (linkpath: string, sourcePath: string) => { path: string } | null;

/**
 * Supported image extensions derived from `MIME_TYPES`.
 * This is used as the canonical filter for "image-ness" across the plugin.
 */
const supportedImageExtensions = new Set(Object.keys(MIME_TYPES));

/**
 * Cache for the vault-wide image index.
 *
 * Keyed by adapter instance so each vault builds at most one index per runtime.
 */
const vaultFileIndexCache = new WeakMap<object, Promise<Map<string, string[]>>>();

/**
 * Check whether a vault path points to a supported image type by extension.
 */
function isSupportedImageFile(filePath: string): boolean {
    const ext = posixExtname(filePath).toLowerCase().replace('.', '');
    return ext.length > 0 && supportedImageExtensions.has(ext);
}

/**
 * Return true if the input is a bare filename (no folder separators).
 *
 * This matches Obsidian's ability to resolve `![[image.png]]` by filename anywhere in the vault.
 */
function isBareFileName(p: string): boolean {
    const normalized = normalizeVaultPath(p);
    if (normalized.length === 0) return false;
    if (normalized.includes('/')) return false;
    return !(normalized === '.' || normalized === '..');
}

/**
 * Best-effort decode for percent-encoded paths (e.g. `image%20name.png`).
 * Returns the original input if decoding fails.
 */
function tryDecodePath(p: string): string {
    if (!/%[0-9A-Fa-f]{2}/.test(p)) return p;
    try {
        return decodeURIComponent(p);
    } catch {
        return p;
    }
}

/**
 * Normalize a vault path and convert it to the format accepted by Obsidian's adapter APIs.
 *
 * Most adapter methods expect vault-root-relative paths without a leading slash.
 */
function toAdapterPath(p: string): string {
    const normalized = normalizeVaultPath(p);
    return normalized.startsWith('/') ? normalized.substring(1) : normalized;
}

/**
 * Normalize the output of `adapter.list()` and ensure a vault-root-relative path.
 *
 * Some adapters may return:
 * - Names relative to the listed folder (`image.png`)
 * - Full vault paths (`folder/image.png`)
 * - Paths with a leading slash (`/folder/image.png`)
 *
 * This helper handles all of the above consistently.
 */
function ensureFullPath(parentDir: string, childPath: string): string {
    const childNormalized = normalizeVaultPath(childPath);
    if (childNormalized.startsWith('/')) {
        return childNormalized.substring(1);
    }

    const parent = toAdapterPath(parentDir);
    const child = toAdapterPath(childNormalized);

    if (!parent) return child;
    if (!child) return parent;

    if (child === parent || child.startsWith(`${parent}/`)) {
        return child;
    }

    return posixJoin(parent, child);
}

/**
 * Decide whether a folder should be skipped during vault indexing.
 *
 * The goal is to avoid scanning large non-content trees (e.g. `.git`) that are
 * commonly present in vaults and can massively inflate traversal time.
 */
function shouldSkipFolder(folderPath: string): boolean {
    const folderName = posixBasename(folderPath);
    return folderName === '.git' || folderName === 'node_modules';
}

/**
 * Split a vault path into normalized segments.
 * Leading slashes and empty segments are removed.
 */
function splitSegments(p: string): string[] {
    const normalized = normalizeVaultPath(p);
    if (!normalized) return [];
    return normalized.split('/').filter(Boolean);
}

/**
 * Compute a simple "directory distance" between two vault directories.
 *
 * The distance is the number of segment hops needed to go from `fromDir` to `toDir`,
 * using their longest common prefix as the meeting point.
 */
function computeDirectoryDistance(fromDir: string, toDir: string): number {
    const fromSegments = splitSegments(fromDir);
    const toSegments = splitSegments(toDir);

    const minLen = Math.min(fromSegments.length, toSegments.length);
    let common = 0;
    while (common < minLen && fromSegments[common] === toSegments[common]) {
        common++;
    }

    return (fromSegments.length - common) + (toSegments.length - common);
}

/**
 * Pick a stable best candidate when multiple vault paths share the same filename.
 *
 * Heuristic:
 * - Prefer candidates whose parent directory is closest to the note's directory.
 * - If tied, prefer shorter paths.
 * - If still tied, use lexicographic order for determinism.
 */
function selectBestCandidate(notePath: string, candidates: string[]): string {
    if (candidates.length === 1) return candidates[0];

    const noteDir = posixDirname(notePath);

    const sorted = [...candidates].sort((a, b) => {
        const aDir = posixDirname(a);
        const bDir = posixDirname(b);

        const aDistance = computeDirectoryDistance(noteDir, aDir);
        const bDistance = computeDirectoryDistance(noteDir, bDir);
        if (aDistance !== bDistance) return aDistance - bDistance;

        if (a.length !== b.length) return a.length - b.length;

        return a.localeCompare(b);
    });

    return sorted[0];
}

/**
 * Build an index for all images in the vault: `filename(lowercase) -> [fullPath...]`.
 *
 * This is used as a fallback for Obsidian-style filename-only links when the exact
 * path is not specified in the note.
 */
async function buildVaultImageIndex(adapter: Required<Pick<VaultLikeAdapter, 'list'>>): Promise<Map<string, string[]>> {
    const index = new Map<string, string[]>();
    const queue: string[] = [''];
    const visited = new Set<string>();

    while (queue.length > 0) {
        const folder = toAdapterPath(queue.shift() ?? '');
        if (visited.has(folder)) continue;
        visited.add(folder);

        let listed: ListedFiles | null = null;
        try {
            listed = await adapter.list(folder);
        } catch {
            if (folder === '') {
                try {
                    listed = await adapter.list('/');
                } catch {
                    listed = null;
                }
            }
        }
        if (!listed) continue;

        for (const file of listed.files) {
            const fullPath = ensureFullPath(folder, file);
            if (!isSupportedImageFile(fullPath)) continue;

            const filename = posixBasename(fullPath);
            if (!filename) continue;

            const key = filename.toLowerCase();
            const existing = index.get(key);
            if (existing) {
                existing.push(fullPath);
            } else {
                index.set(key, [fullPath]);
            }
        }

        for (const subFolder of listed.folders) {
            const fullFolder = ensureFullPath(folder, subFolder);
            if (shouldSkipFolder(fullFolder)) continue;
            queue.push(fullFolder);
        }
    }

    return index;
}

/**
 * Get (or build) the cached vault image index for a given adapter instance.
 *
 * The index build is intentionally lazy and only triggered when the filename fallback is needed.
 */
async function getVaultImageIndex(adapter: VaultLikeAdapter): Promise<Map<string, string[]>> {
    if (!adapter.list) return new Map<string, string[]>();

    const key = adapter as unknown as object;
    const cached = vaultFileIndexCache.get(key);
    if (cached) return cached;

    const building = buildVaultImageIndex({list: adapter.list});
    vaultFileIndexCache.set(key, building);
    return building;
}

/**
 * Resolve a bare filename to a vault-root-relative path by searching the vault index.
 *
 * This only runs for filenames with a supported image extension and does not attempt
 * fuzzy matching. If multiple candidates exist, a stable best candidate is selected.
 */
async function resolveByFileName(notePath: string, fileName: string, adapter: VaultLikeAdapter): Promise<string | null> {
    if (!isBareFileName(fileName)) return null;

    const ext = posixExtname(fileName).toLowerCase().replace('.', '');
    if (!ext || !supportedImageExtensions.has(ext)) return null;

    const index = await getVaultImageIndex(adapter);
    const candidates = index.get(fileName.toLowerCase());
    if (!candidates || candidates.length === 0) return null;

    const best = selectBestCandidate(notePath, candidates);
    if (await adapter.exists(best)) {
        return best;
    }

    vaultFileIndexCache.delete(adapter as unknown as object);
    const refreshedIndex = await getVaultImageIndex(adapter);
    const refreshedCandidates = refreshedIndex.get(fileName.toLowerCase());
    if (!refreshedCandidates || refreshedCandidates.length === 0) return null;

    const refreshedBest = selectBestCandidate(notePath, refreshedCandidates);
    return (await adapter.exists(refreshedBest)) ? refreshedBest : null;
}

/**
 * Resolve a relative image path to an absolute path using a vault-like adapter.
 *
 * Uses POSIX-style paths to ensure compatibility with Obsidian vault on all platforms.
 * Obsidian's DataAdapter.exists() expects forward slashes even on Windows.
 *
 * @param notePath Source note path in the vault (used for relative resolution)
 * @param imagePath Raw link destination extracted from markdown
 * @param adapter Vault adapter used for existence checks and directory listing
 * @param linkpathResolver Optional Obsidian-style resolver (e.g. `metadataCache.getFirstLinkpathDest`)
 */
export async function resolveAbsolutePath(
    notePath: string,
    imagePath: string,
    adapter: VaultLikeAdapter,
    linkpathResolver?: LinkpathResolver
): Promise<string | null> {
    // Normalize the image path first
    const normalizedImagePath = normalizeVaultPath(imagePath);
    const decodedImagePath = tryDecodePath(normalizedImagePath);

    // If it's already absolute (starts with /), use as-is
    if (normalizedImagePath.startsWith('/')) {
        const absolutePath = normalizedImagePath.substring(1); // Remove leading /
        if (await adapter.exists(absolutePath)) {
            return absolutePath;
        }
        return null;
    }

    // Try relative to the note's directory first
    const noteDir = posixDirname(notePath);
    if (noteDir) {
        const relativePath = posixJoin(noteDir, normalizedImagePath);
        if (await adapter.exists(relativePath)) {
            return relativePath;
        }
    }

    // Try as vault-root-relative path
    if (await adapter.exists(normalizedImagePath)) {
        return normalizedImagePath;
    }

    // Prefer Obsidian's resolver when available. This handles filename-only links
    // and other resolution rules that are difficult to reproduce purely via the adapter.
    if (linkpathResolver) {
        const resolvedDest =
            linkpathResolver(normalizedImagePath, notePath) ??
            (decodedImagePath !== normalizedImagePath
                ? linkpathResolver(decodedImagePath, notePath)
                : null);
        if (resolvedDest) {
            const resolvedPath = toAdapterPath(resolvedDest.path);
            if (await adapter.exists(resolvedPath)) {
                return resolvedPath;
            }
        }
    }

    // Obsidian can resolve links by filename anywhere in the vault.
    // This is a best-effort fallback for cases like: ![[image.png]] or ![](image.png)
    //
    // NOTE: The first use may trigger a vault-wide scan (cached per adapter instance).
    const byName =
        (await resolveByFileName(notePath, normalizedImagePath, adapter)) ??
        (decodedImagePath !== normalizedImagePath
            ? await resolveByFileName(notePath, decodedImagePath, adapter)
            : null);
    if (byName) {
        return byName;
    }

    return null;
}

/**
 * Lookup mime type by file extension.
 */
export function getMimeType(fileName: string): string {
    const extension = posixExtname(fileName).toLowerCase().replace('.', '');
    const mimeType = MIME_TYPES[extension];
    return mimeType || 'application/octet-stream';
}

/**
 * Human readable file size string.
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
