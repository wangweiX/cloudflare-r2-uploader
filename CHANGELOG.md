# 更新日志

## [1.0.2] - 2025-03-xx

### 修复
- 解决了 Cloudflare R2 上传时遇到的 CORS 跨域问题
- 添加了 S3 API 凭证支持作为解决 CORS 问题的替代方法

### 改进
- 使用 AWS SDK for S3 实现了与 Cloudflare R2 的通信，提供更稳定的上传体验
- 增强了错误处理和日志记录，使问题诊断更加清晰
- 优化了设置界面，添加了 S3 API 凭证设置选项

### 使用说明
- 用户现在可以选择使用 API 令牌或 S3 API 凭证进行上传
- 如果遇到 CORS 问题，建议在 Cloudflare R2 控制台创建 S3 API 凭证并填入插件设置

## [1.0.1] - 2025-03-xx

### 修复
- 修复了无法识别 Obsidian 内部链接格式图片 `![[图片文件名.jpg]]` 的问题
- 修复了处理临时占位符图片 `pasted-image-xxx` 导致错误的问题
- 增强了文件路径解析，添加文件存在检查以减少错误

### 改进
- 同时支持标准 Markdown 图片格式 `![alt](path)` 和 Obsidian 内部链接格式 `![[path]]`
- 上传后将 Obsidian 内部链接格式转换为标准 Markdown 格式
- 完善了错误处理和日志记录

## [1.0.0] - 2025-03-01

### 特性
- 初始版本发布
- 支持上传 Obsidian 笔记中的图片到 Cloudflare Images
- 支持上传到 Cloudflare R2 存储
- 自动替换本地图片链接为云端 URL 