# 笔记图片上传cloudflare

这是一个 Obsidian 插件，可以自动将您笔记中的图片上传到 Cloudflare Images 并更新笔记中的链接为云端 URL。

## 功能

- 将本地图片上传到 Cloudflare Images
- 自动更新笔记中的图片链接
- 保持上传记录，避免重复上传

## 安装

1. 在 Obsidian 中从社区插件浏览器安装 (待发布)
2. 或手动安装:
   - 下载最新的 release
   - 解压到 `.obsidian/plugins/cloudflare-images-uploader` 目录

## 配置

1. 在 Obsidian 设置中找到 "Cloudflare Images Uploader"
2. 输入您的 Cloudflare Account ID
3. 输入您的 Cloudflare API Token (需要 Images 权限)

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

