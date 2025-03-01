import { Notice } from 'obsidian';
import * as path from 'path';
import { CloudflareApiResponse, CloudflareImageResult, UploadResult } from '../models/cloudflare';
import { PluginSettings } from '../models/settings';
import { StorageProvider, StorageProviderType } from '../models/storage-provider';

/**
 * Cloudflare Images服务 - 负责处理与Cloudflare Images的通信
 * 实现了StorageProvider接口，遵循策略模式
 */
export class CloudflareImagesService implements StorageProvider {
  /**
   * 构造函数
   */
  constructor(private settings: PluginSettings) {}
  
  /**
   * 获取提供者类型
   */
  public getType(): StorageProviderType {
    return StorageProviderType.CLOUDFLARE_IMAGES;
  }
  
  /**
   * 上传图片到Cloudflare
   */
  public async uploadFile(filePath: string, fileContent: ArrayBuffer): Promise<UploadResult> {
    return this.uploadImage(filePath, fileContent);
  }
  
  /**
   * 上传图片到Cloudflare (兼容原有方法)
   */
  public async uploadImage(imagePath: string, fileContent: ArrayBuffer): Promise<UploadResult> {
    try {
      const { accountId, apiToken } = this.settings;
      const fileName = path.basename(imagePath);
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`;
      
      // 准备表单数据
      const formData = new FormData();
      const blob = new Blob([fileContent], { type: 'application/octet-stream' });
      formData.append('file', blob, fileName);
      
      // 发送请求
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        },
        body: formData
      });
      
      // 解析响应
      const json = await response.json() as CloudflareApiResponse<CloudflareImageResult>;
      
      if (json.success && json.result) {
        return {
          success: true,
          localPath: imagePath,
          imageId: json.result.id
        };
      } else {
        const errorMessage = json.errors?.[0]?.message || '未知错误';
        console.error(`上传图片失败 ${imagePath}: ${errorMessage}`);
        new Notice(`上传图片失败: ${fileName}`, 3000);
        return {
          success: false,
          localPath: imagePath,
          error: errorMessage
        };
      }
    } catch (error) {
      console.error(`处理图片时出错 ${imagePath}:`, error);
      new Notice(`处理图片出错: ${path.basename(imagePath)}`, 3000);
      return {
        success: false,
        localPath: imagePath,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * 获取Cloudflare图片的URL
   */
  public getFileUrl(imageId: string): string {
    return this.getImageUrl(imageId);
  }
  
  /**
   * 获取Cloudflare图片的URL (兼容原有方法)
   */
  public getImageUrl(imageId: string): string {
    return `https://${this.settings.accountId}.imagedelivery.net/${imageId}`;
  }
} 