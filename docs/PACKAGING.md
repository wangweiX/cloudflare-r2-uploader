# 打包与测试指南

本文档提供了如何打包 Cloudflare Images Uploader 插件并在 Obsidian 中测试的步骤。

## 打包插件

我们提供了一个自动化脚本来打包插件。这个脚本会构建项目，并将所需文件打包成 Obsidian 可用的格式。

### 步骤

1. 确保已安装所有依赖：
   ```bash
   npm install
   ```

2. 运行打包脚本：
   ```bash
   npm run package
   ```

3. 打包完成后，你将在 `build` 目录中找到以下内容：
   - `cloudflare-images-uploader/` 文件夹 - 包含插件的所有文件
   - `cloudflare-images-uploader.zip` - 压缩后的插件包

## 在 Obsidian 中测试

有两种方法可以在 Obsidian 中测试此插件：

### 方法 1：手动安装

1. 打开 Obsidian
2. 转到 设置 > 第三方插件
3. 关闭"限制模式"（如果开启）
4. 点击"浏览"按钮旁边的文件夹图标打开插件文件夹
5. 创建一个名为 `cloudflare-images-uploader` 的新文件夹
6. 复制 `build/cloudflare-images-uploader/` 中的所有文件到这个新文件夹
7. 重启 Obsidian
8. 返回到 设置 > 第三方插件，启用 "Cloudflare Images Uploader" 插件

### 方法 2：使用 BRAT 插件

如果你已经安装了 [BRAT (Beta Reviewer's Auto-update Tool)](https://github.com/TfTHacker/obsidian42-brat) 插件：

1. 打开 Obsidian
2. 转到 设置 > 社区插件 > BRAT
3. 选择"从存储库安装"
4. 选择"添加 Beta 插件 by path to zip file"
5. 输入你的本地 zip 文件路径，例如：
   `/path/to/your/project/build/cloudflare-images-uploader.zip`
6. 按照 BRAT 的提示完成安装
7. 在 设置 > 第三方插件 中启用该插件

## 调试

在测试过程中如果遇到问题，你可以：

1. 在 Obsidian 中打开开发者控制台（按 `Ctrl+Shift+I` 或 `Cmd+Option+I`）查看错误日志
2. 检查 Obsidian 的控制台日志
3. 确保插件的所有必需文件都已正确复制到 Obsidian 的插件目录中

## 插件结构

Obsidian 插件的基本结构包括：

- `main.js` - 编译后的插件代码
- `manifest.json` - 插件元数据
- `styles.css` - 样式文件（如果有）
- `README.md` - 说明文档

每次修改插件代码后，请重新运行打包脚本并按照上述步骤重新安装测试。 