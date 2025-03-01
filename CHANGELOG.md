# 更新日志

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