import * as path from 'path';
import {v4 as uuidv4} from 'uuid';
import {MIME_TYPES} from '../config';

/**
 * Generate a unique, sanitized file name.
 */
export function generateUniqueFileName(originalName: string): string {
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9\u4e00-\u9fa5_.-]/g, '_');
    const timestamp = Date.now();
    const randomId = uuidv4().split('-')[0];
    return `${baseName}_${timestamp}_${randomId}${ext}`;
}

/**
 * Resolve a relative image path to an absolute path using a vault-like adapter.
 */
export async function resolveAbsolutePath(
    notePath: string,
    imagePath: string,
    adapter: { exists: (p: string) => Promise<boolean> }
): Promise<string | null> {
    if (path.isAbsolute(imagePath)) {
        return imagePath;
    }

    const noteDir = path.dirname(notePath);
    let absolutePath = path.normalize(path.join(noteDir, imagePath));
    if (await adapter.exists(absolutePath)) {
        return absolutePath;
    }

    absolutePath = path.normalize(imagePath);
    if (await adapter.exists(absolutePath)) {
        return absolutePath;
    }

    return null;
}

/**
 * Lookup mime type by file extension.
 */
export function getMimeType(fileName: string): string {
    const extension = path.extname(fileName).toLowerCase().replace('.', '');
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
