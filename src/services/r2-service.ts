import { Notice } from 'obsidian';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { UploadResult } from '../models/cloudflare';
import { R2Config, StorageProvider, StorageProviderType } from '../models/storage-provider';
import { Logger } from '../utils/logger';

/**
 * Cloudflare R2服务 - 负责处理与Cloudflare R2存储的通信
 * 实现了StorageProvider接口，遵循策略模式
 */
export class R2Service implements StorageProvider {
  private logger: Logger;
  
  /**
   * 构造函数
   */
  constructor(private config: R2Config) {
    this.logger = Logger.getInstance();
  }
  
  /**
   * 获取提供者类型
   */
  public getType(): StorageProviderType {
    return StorageProviderType.CLOUDFLARE_R2;
  }
  
  /**
   * 上传文件到R2存储桶
   */
  public async uploadFile(filePath: string, fileContent: ArrayBuffer): Promise<UploadResult> {
    try {
      const { accountId, apiToken, bucket } = this.config;
      
      // 获取文件信息
      const fileName = path.basename(filePath);
      const fileExt = path.extname(fileName);
      
      // 生成唯一文件名
      const uniqueId = uuidv4();
      const objectKey = `images/${uniqueId}${fileExt}`;
      
      // 构建API URL
      const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects/${objectKey}`;
      
      // 准备请求
      const blob = new Blob([fileContent]);
      
      // 发送请求
      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': this.getMimeType(fileExt)
        },
        body: blob
      });
      
      if (response.ok) {
        this.logger.info(`文件上传到R2成功: ${fileName} -> ${objectKey}`);
        
        return {
          success: true,
          localPath: filePath,
          imageId: objectKey
        };
      } else {
        const errorText = await response.text();
        this.logger.error(`上传到R2失败 ${filePath}: ${response.status} ${errorText}`);
        new Notice(`上传文件失败: ${fileName}`, 3000);
        
        return {
          success: false,
          localPath: filePath,
          error: `HTTP Error ${response.status}: ${errorText}`
        };
      }
    } catch (error) {
      this.logger.error(`处理文件时出错 ${filePath}:`, error);
      new Notice(`处理文件出错: ${path.basename(filePath)}`, 3000);
      
      return {
        success: false,
        localPath: filePath,
        error: (error as Error).message
      };
    }
  }
  
  /**
   * 获取R2文件的URL
   */
  public getFileUrl(objectKey: string): string {
    const { accountId, bucket, customDomain } = this.config;
    
    // 如果设置了自定义域名，使用自定义域名
    if (customDomain) {
      return `${customDomain}/${objectKey}`;
    }
    
    // 否则使用Cloudflare默认R2域名
    return `https://${bucket}.${accountId}.r2.cloudflarestorage.com/${objectKey}`;
  }
  
  /**
   * 根据文件扩展名获取MIME类型
   */
  private getMimeType(ext: string): string {
    const mimeMap: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.md': 'text/markdown'
    };
    
    return mimeMap[ext.toLowerCase()] || 'application/octet-stream';
  }
} 