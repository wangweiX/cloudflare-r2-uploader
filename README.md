# Cloudflare R2 图片上传插件

## 概述

这是一个功能强大的 Obsidian 插件，可以自动将您笔记中的本地图片上传到 Cloudflare R2 存储，并将本地链接替换为云端 URL。支持批量上传、自动粘贴上传等功能，让您的笔记图片管理更加便捷。

## 主要功能

### 🚀 核心功能
- **批量上传**：一键上传当前笔记或所有笔记中的本地图片
- **自动粘贴上传**：粘贴图片时自动上传到云端（可选功能）
- **智能去重**：自动记录已上传的图片，避免重复上传
- **链接自动替换**：上传成功后自动更新笔记中的图片链接
- **支持多种格式**：支持标准 Markdown 格式 `![alt](path)` 和 Obsidian 格式 `![[path]]`

### ⚡ 高级功能
- **并发上传**：支持 1-50 个文件同时上传，显著提升效率
- **自动重试**：网络错误时自动重试，确保上传成功
- **进度通知**：实时显示上传进度和结果
- **本地文件管理**：可选择上传成功后自动删除本地图片
- **自定义配置**：灵活的文件夹路径、自定义域名等配置

## 安装

### 方法一：从 Obsidian 社区插件安装（推荐）
1. 打开 Obsidian 设置
2. 进入「第三方插件」
3. 禁用安全模式
4. 点击「浏览」并搜索「Cloudflare R2 Uploader」
5. 点击安装并启用插件

### 方法二：手动安装
1. 下载最新的 [Release](https://github.com/wangweiX/obsidian-cloudflare-r2-uploader/releases)
2. 解压文件到 Obsidian 库的插件文件夹：`.obsidian/plugins/cloudflare-r2-uploader`
3. 重启 Obsidian
4. 在设置中启用插件

## 配置指南

### 第一步：部署 Cloudflare R2 Worker

本插件需要配合 [Cloudflare R2 Worker](https://github.com/wangweiX/cloudflare-r2-worker) 使用。

#### 前置要求
- Cloudflare 账户
- 已创建 R2 存储桶
- Node.js 16+ 环境

#### 部署步骤

1. **克隆 Worker 仓库**
```bash
git clone https://github.com/wangweiX/cloudflare-r2-worker
cd cloudflare-r2-worker
npm install
```

2. **配置 Worker**
编辑 `wrangler.toml` 文件：
```toml
name = "cloudflare-r2-worker"

[[r2_buckets]]
binding = "image"
bucket_name = "your-bucket-name"  # 替换为您的存储桶名称
```

3. **设置环境变量**
在 Cloudflare Dashboard 中设置 Worker 环境变量：
- `API_KEY`: 设置一个安全的 API 密钥（至少 32 位随机字符）

4. **部署到 Cloudflare**
```bash
npm run deploy
```

部署成功后会显示 Worker URL，格式为：`https://your-worker-name.your-subdomain.workers.dev`

### 第二步：配置插件

1. 打开 Obsidian 设置 → Cloudflare R2 Uploader
2. 填写以下配置：

#### 基础设置
- **启用自动粘贴上传**：开启后粘贴图片时自动上传
- **上传成功后删除本地图片**：开启后会自动清理本地图片文件

#### Cloudflare Worker 设置
- **Worker URL**：填入部署后的 Worker 地址
- **API Key**：填入在 Worker 中设置的 API 密钥
- **存储桶名称**：填入 R2 存储桶名称
- **文件夹名称**（可选）：指定上传到存储桶的哪个文件夹
- **自定义域名**（可选）：如果配置了自定义域名，填入完整域名

#### 高级设置
- **最大并发上传数**：1-50，建议设置为 3-10
- **最大重试次数**：上传失败时的重试次数
- **重试延迟**：重试前的等待时间（毫秒）
- **上传超时**：单个文件的上传超时时间

## 使用方法

### 上传当前笔记中的图片
1. 打开包含本地图片的笔记
2. 点击左侧边栏的上传图标 📤
3. 或使用命令面板：`Ctrl/Cmd + P` → 输入「上传当前笔记中的图片」

### 批量上传所有笔记中的图片
1. 使用命令面板：`Ctrl/Cmd + P`
2. 输入「上传所有笔记中的图片」
3. 确认开始批量上传

### 自动粘贴上传
1. 在设置中启用「自动粘贴上传」
2. 复制图片到剪贴板
3. 在笔记中粘贴，图片会自动上传并插入云端链接

## 功能特性

### 智能文件命名
- 自动生成唯一文件名，格式：`原始名称_时间戳_随机ID.扩展名`
- 防止文件名冲突和覆盖

### 支持的图片格式
- JPG/JPEG
- PNG
- GIF
- WebP
- SVG
- BMP
- ICO
- TIFF

### 错误处理
- 网络错误自动重试
- 详细的错误提示
- 上传失败不会影响其他文件

## 常见问题

### Q: 上传失败怎么办？
A: 请检查：
1. Worker URL 是否正确
2. API Key 是否与 Worker 配置一致
3. 存储桶名称是否正确
4. 网络连接是否正常

### Q: 支持哪些图片格式？
A: 支持常见的图片格式，包括 JPG、PNG、GIF、WebP、SVG 等。具体支持列表取决于 Worker 配置。

### Q: 可以上传多大的图片？
A: 默认支持最大 100MB 的图片文件，可在 Worker 配置中调整。

### Q: 如何避免重复上传？
A: 插件会自动记录已上传的文件，相同路径的文件不会重复上传。

### Q: 上传后的图片 URL 是永久的吗？
A: 是的，只要您的 R2 存储桶和 Worker 保持运行，URL 就会一直有效。

## 开发指南

### 环境准备
```bash
# 克隆仓库
git clone https://github.com/wangweiX/obsidian-cloudflare-r2-uploader
cd obsidian-cloudflare-r2-uploader

# 安装依赖
npm install
```

### 开发命令
```bash
# 开发模式（自动重新加载）
npm run dev

# 构建生产版本
npm run build

# 打包发布
npm run package
```

### 项目结构
```
src/
├── core/           # 核心插件逻辑
├── models/         # 数据模型和接口
├── services/       # 业务服务
├── ui/             # 用户界面组件
└── utils/          # 工具函数
```

## 贡献指南

欢迎提交 Issue 和 Pull Request！

### 提交 Issue
- 使用清晰的标题描述问题
- 提供详细的复现步骤
- 附上相关的错误日志

### 提交 PR
- Fork 本仓库
- 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
- 提交您的修改 (`git commit -m 'Add some AmazingFeature'`)
- 推送到分支 (`git push origin feature/AmazingFeature`)
- 打开一个 Pull Request

## 更新日志

查看 [CHANGELOG.md](docs/CHANGELOG.md) 了解版本更新内容。

## 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 致谢

- 感谢 [Obsidian](https://obsidian.md/) 提供了优秀的笔记软件
- 感谢 [Cloudflare R2](https://www.cloudflare.com/products/r2/) 提供了可靠的对象存储服务
- 感谢所有贡献者的支持

## 支持

如果您觉得这个插件有用，欢迎：
- 给项目点个 ⭐ Star
- 分享给更多 Obsidian 用户
- 提供反馈和建议

---

Made with ❤️ by [wangwei](https://github.com/wangweiX)