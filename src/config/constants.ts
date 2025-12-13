export const UPLOAD_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="100" height="100" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`;

export const UPLOAD_EVENTS = {
    TASK_ADDED: 'task:added',
    TASK_STARTED: 'task:started',
    TASK_PROGRESS: 'task:progress',
    TASK_COMPLETED: 'task:completed',
    TASK_FAILED: 'task:failed',
    TASK_CANCELLED: 'task:cancelled',
    QUEUE_EMPTY: 'queue:empty',
    STATS_UPDATED: 'stats:updated'
} as const;

export const IMAGE_PATTERNS = {
    STANDARD_MARKDOWN: /!\[([^\]]*)\]\(([^)]*)\)/g,
    OBSIDIAN_INTERNAL: /!\[\[([^\]]+)\]\]/g
} as const;

export const MIME_TYPES: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    tiff: 'image/tiff',
    tif: 'image/tiff'
};
