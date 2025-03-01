import { App } from 'obsidian';

/**
 * 存储服务 - 负责处理映射文件的读写
 * 实现了单例模式
 */
export class StorageService {
  private static instance: StorageService;

  private constructor(private app: App) {}
  
  /**
   * 获取存储服务的实例
   */
  public static getInstance(app: App): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService(app);
    }
    return StorageService.instance;
  }
}
