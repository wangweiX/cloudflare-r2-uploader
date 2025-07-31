# Cloudflare R2 图片上传插件

<div align="center">

[![Release](https://img.shields.io/github/v/release/wangweiX/cloudflare-r2-uploader)](https://github.com/wangweiX/cloudflare-r2-uploader/releases)
[![Downloads](https://img.shields.io/github/downloads/wangweiX/cloudflare-r2-uploader/total)](https://github.com/wangweiX/cloudflare-r2-uploader/releases)
[![License](https://img.shields.io/github/license/wangweiX/cloudflare-r2-uploader)](LICENSE)

一个功能强大的 Obsidian 插件，自动将笔记中的本地图片上传到 Cloudflare R2 存储，支持批量上传、自动粘贴上传等功能。

[English](README_EN.md) | 简体中文

</div>

## ✨ 核心特性

- 🚀 **两种上传方式** - 支持 Worker 代理和 R2 S3 API 直连
- 📤 **批量上传** - 一键上传当前笔记或所有笔记中的图片
- 📋 **自动粘贴上传** - 粘贴图片时自动上传并替换链接
- 🔄 **智能去重** - 自动记录已上传文件，避免重复上传
- ⚡ **并发控制** - 支持 1-50 个文件同时上传
- 🔁 **自动重试** - 网络错误时智能重试，确保上传成功
- 📊 **实时进度** - 上传状态窗口，实时显示进度
- 🗑️ **自动清理** - 可选择上传成功后删除本地文件

## 🚀 快速开始

### 1. 安装插件

**从 Obsidian 社区插件安装（推荐）**
1. 打开 Obsidian 设置
2. 进入「第三方插件」→「浏览」
3. 搜索「Cloudflare R2 Uploader」
4. 点击安装并启用

**手动安装**
1. 下载最新 [Release](https://github.com/wangweiX/obsidian-cloudflare-r2-uploader/releases)
2. 解压到 `.obsidian/plugins/cloudflare-r2-uploader`
3. 在设置中启用插件

### 2. 选择上传方式

本插件支持两种上传方式，您可以根据需求选择：

| 方式 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| **Worker 代理** | 无需暴露密钥<br>支持自定义逻辑<br>更安全 | 需要部署 Worker<br>有请求限制 | 安全性要求高<br>需要自定义处理 |
| **R2 S3 API 直连** | 配置简单<br>性能更好<br>无中间层 | 密钥存储在本地<br>可能遇到 CORS 错误 | 个人使用<br>追求简单高效 |

### 3. 开始使用

配置完成后，您可以：
- 点击左侧边栏的上传图标 📤
- 使用命令面板（`Cmd/Ctrl + P`）执行上传命令
- 启用自动粘贴上传功能

## 📖 详细配置指南

### 方式一：Cloudflare Worker（传统方式）

适合需要更高安全性和自定义功能的用户。

#### 步骤 1：部署 Worker

1. **准备工作**
   - 拥有 Cloudflare 账户
   - 创建 R2 存储桶
   - 安装 Node.js 16+

2. **部署 Worker**
   ```bash
   # 克隆 Worker 仓库
   git clone https://github.com/wangweiX/cloudflare-r2-worker
   cd cloudflare-r2-worker
   npm install
   
   # 配置 wrangler.toml
   # 修改 bucket_name 为您的存储桶名称
   
   # 部署
   npm run deploy
   ```

3. **设置环境变量**
   - 在 Cloudflare Dashboard 中设置 `API_KEY`（至少 32 位）

#### 步骤 2：配置插件

在 Obsidian 设置中：
1. 存储提供者选择「Cloudflare Worker」
2. 填写 Worker URL
3. 填写 API Key
4. 填写存储桶名称

### 方式二：R2 S3 API 直连（新方式）

适合追求简单配置和高性能的用户。

#### 步骤 1：创建 R2 API 令牌

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 进入 R2 → 管理 R2 API 令牌
3. 创建新令牌，权限选择「对象读和写」
4. 保存 Access Key ID 和 Secret Access Key

#### 步骤 2：配置插件

在 Obsidian 设置中：
1. 存储提供者选择「R2 S3 API (直连)」
2. 填写账户 ID（控制台右侧可见）
3. 填写 Access Key ID 和 Secret Access Key
4. 填写存储桶名称

#### 步骤 3：配置 CORS（可选）

如果遇到 CORS 错误，可以在 R2 存储桶设置中添加 CORS 规则：
```json
[
  {
    "AllowedOrigins": ["app://obsidian.md", "*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

> 注意：CORS 错误通常不影响上传，插件会自动重试。

## 📚 使用指南

### 基本操作

**上传当前笔记的图片**
- 点击侧边栏上传图标 📤
- 或使用命令：「上传当前笔记中的图片」

**批量上传所有图片**
- 使用命令：「上传所有笔记中的图片」
- 适合首次迁移或批量处理

**自动粘贴上传**
1. 启用「自动粘贴上传」选项
2. 复制或截图
3. 粘贴到笔记中即可自动上传

### 高级功能

**并发控制**
- 最大并发上传数：1-50（默认 3）
- 根据网速调整：慢速网络 1-3，高速网络 10-50

**重试机制**
- 最大重试次数：0-5（默认 3）
- 重试延迟：采用指数退避策略
- 支持超时设置

**上传管理**
- 实时进度显示
- 支持取消上传
- 失败任务可重试
- 上传历史记录

## ❓ 常见问题

### CORS 错误
**问题**：控制台显示 CORS policy 错误  
**解决**：这是正常现象，插件会自动重试。可选择配置 CORS 规则或忽略。

### 上传失败
**检查清单**：
- [ ] 配置信息是否正确
- [ ] 网络连接是否正常
- [ ] API 权限是否足够
- [ ] 存储桶是否存在

### 图片未更新
**可能原因**：
- 图片格式不被支持（仅支持 `![alt](path)` 和 `![[path]]`）
- 图片路径包含特殊字符
- 笔记未保存

### 性能优化
- 上传前压缩大图片
- 合理设置并发数
- 使用 WebP 等高效格式

## 🔧 开发指南

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
# 开发模式（自动重载）
npm run dev

# 构建生产版本
npm run build

# 打包插件
npm run package
```

### 项目结构
```
src/
├── core/           # 核心插件逻辑
├── models/         # 数据模型
├── services/       # 业务服务
│   ├── worker-service.ts      # Worker 方式实现
│   ├── r2-s3-service.ts       # S3 API 方式实现
│   └── upload-manager.ts      # 上传管理器
├── ui/             # 用户界面
└── utils/          # 工具函数
```

### 调试方法
1. 开启「显示详细日志」选项
2. 打开开发者工具（`Cmd/Ctrl + Shift + I`）
3. 查看 Console 中的日志

## 🤝 贡献指南

欢迎贡献代码、报告问题或提出建议！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 📝 更新日志

### v1.1.0
- ✨ 新增 R2 S3 API 直连方式
- 🚀 改进上传管理器，支持并发控制
- 📊 新增上传状态窗口
- 🔁 优化重试机制
- 🐛 修复多个已知问题

[查看完整更新日志](https://github.com/wangweiX/cloudflare-r2-uploader/releases)

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 🙏 致谢

- [Obsidian](https://obsidian.md/) - 优秀的知识管理工具
- [Cloudflare R2](https://www.cloudflare.com/products/r2/) - 可靠的对象存储服务
- [@aws-sdk/client-s3](https://www.npmjs.com/package/@aws-sdk/client-s3) - AWS SDK for JavaScript
- 所有贡献者和用户的支持

## 💖 支持项目

如果这个插件对您有帮助：
- 给项目一个 ⭐ Star
- 分享给其他 Obsidian 用户
- [报告问题](https://github.com/wangweiX/cloudflare-r2-uploader/issues)或[参与讨论](https://github.com/wangweiX/cloudflare-r2-uploader/discussions)

---

<div align="center">
Made with ❤️ by <a href="https://github.com/wangweiX">wangwei</a>
</div>