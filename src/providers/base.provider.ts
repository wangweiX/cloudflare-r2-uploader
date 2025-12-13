export class BaseStorageProvider {
    protected buildFilePath(folderName: string | undefined, fileName: string): string {
        const folder = this.sanitizeFolderName(folderName);
        return folder ? `${folder}/${fileName}` : fileName;
    }

    protected sanitizeFolderName(folderName?: string): string {
        if (!folderName) return '';
        let sanitized = folderName.replace(/\\/g, '/').trim();
        sanitized = sanitized.replace(/^\/+|\/+$/g, '');
        sanitized = sanitized.replace(/\/{2,}/g, '/');
        return sanitized;
    }

    protected buildPublicUrl(customDomain: string | undefined, filePath: string, fallbackBase: string): string {
        if (customDomain && customDomain.trim() !== '') {
            const domainBase = customDomain.startsWith('http') ? customDomain : `https://${customDomain}`;
            const formattedDomain = domainBase.endsWith('/') ? domainBase.slice(0, -1) : domainBase;
            return `${formattedDomain}/${filePath}`;
        }

        const base = fallbackBase.endsWith('/') ? fallbackBase.slice(0, -1) : fallbackBase;
        return `${base}/${filePath}`;
    }
}
