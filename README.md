# cloudflare R2上传工具

## 概述

这是一个 Obsidian 插件，可以自动将您笔记中的图片上传到 Cloudflare R2 存储并更新笔记中的链接为云端 URL。

## 功能

- 将本地图片上传到 Cloudflare R2 存储
- 自动更新笔记中的图片链接
- 保持上传记录，避免重复上传

## 安装

1. 在 Obsidian 中从社区插件浏览器安装 (待发布)
2. 或手动安装:
   - 下载最新的 release
   - 解压到 `.obsidian/plugins/cloudflare-r2-uploader` 目录

## 部署 Cloudflare R2 Worker

本插件需要您自行部署 Cloudflare R2 Worker 来处理图片上传。请按照以下步骤操作：

### 前提条件

1. 拥有 Cloudflare 账户
2. 创建一个 R2 存储桶
3. 安装 Node.js 和 npm

### 部署步骤

1. 克隆 Worker 仓库:  
```bash
git clone https://github.com/wangweiX/cloudflare-r2-worker
cd cloudflare-r2-worker
```

2. 安装依赖:  
```bash
npm install
```

3. 修改 `wrangler.toml` 文件:  
   - 将 `bucket_name` 修改为您的 R2 存储桶名称  
   - 设置 `API_KEY` 为一个安全的 API 密钥 (您将在插件配置中使用此密钥)

4. 使用 Wrangler 部署到 Cloudflare:  
```bash
npm run deploy
```

5. 部署完成后，您将获得一个 Worker URL，格式为 `https://<your-worker>.workers.dev/`

## 配置

1. 在 Obsidian 设置中找到 "Cloudflare Images Uploader"
2. 输入您的 Cloudflare Account ID
3. 输入您部署的 Worker URL (`https://<your-worker>.workers.dev/`)
4. 输入您在 `wrangler.toml` 中设置的 API 密钥

## 使用说明

配置完成后，当您在笔记中粘贴或插入图片时，插件将自动：

1. 将图片上传到您的 Cloudflare R2 存储
2. 将笔记中的本地图片链接替换为 R2 存储中的 URL

## 故障排除

- 确保您的 Cloudflare R2 存储桶已正确配置并可访问
- 检查 Worker 是否成功部署并运行
- 验证您输入的 API 密钥与 `wrangler.toml` 中配置的相匹配

## 开发

```bash
# 安装依赖
npm install

# 开发模式
npm run dev

# 构建插件
npm run build
```

## 许可证
MIT

