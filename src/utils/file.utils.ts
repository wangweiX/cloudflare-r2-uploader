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
 * Resolve a relative image path to an absolute path using a vault-like adapter.
 *
 * Uses POSIX-style paths to ensure compatibility with Obsidian vault on all platforms.
 * Obsidian's DataAdapter.exists() expects forward slashes even on Windows.
 */
export async function resolveAbsolutePath(
    notePath: string,
    imagePath: string,
    adapter: { exists: (p: string) => Promise<boolean> }
): Promise<string | null> {
    // Normalize the image path first
    const normalizedImagePath = normalizeVaultPath(imagePath);

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
