#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

// 确保安装 archiver 依赖
try {
  require.resolve('archiver');
} catch (e) {
  console.log('正在安装打包所需的依赖...');
  execSync('npm install --save-dev archiver');
  console.log('依赖安装完成！');
}

// 设置相关路径
const PLUGIN_NAME = 'cloudflare-images-uploader';
const ROOT_DIR = path.resolve(__dirname);
const BUILD_DIR = path.join(ROOT_DIR, 'build');
const PACKAGE_DIR = path.join(BUILD_DIR, PLUGIN_NAME);

// 创建输出目录
console.log('创建输出目录...');
if (fs.existsSync(BUILD_DIR)) {
  fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}
fs.mkdirSync(BUILD_DIR);
fs.mkdirSync(PACKAGE_DIR);

// 构建项目
console.log('构建项目...');
try {
  execSync('npm run build', { stdio: 'inherit' });
} catch (e) {
  console.error('构建失败:', e);
  process.exit(1);
}

// 要复制的文件列表
const files = [
  'main.js',
  'manifest.json',
  'README.md'
];

// 可选文件（存在则复制）
const optionalFiles = [
  'styles.css'
];

// 复制文件到构建目录
console.log('复制文件到构建目录...');
files.forEach(file => {
  if (fs.existsSync(path.join(ROOT_DIR, file))) {
    fs.copyFileSync(
      path.join(ROOT_DIR, file),
      path.join(PACKAGE_DIR, file)
    );
    console.log(`  - 已复制 ${file}`);
  } else {
    console.warn(`  - 警告: ${file} 不存在，跳过`);
  }
});

// 复制可选文件（如果存在）
optionalFiles.forEach(file => {
  if (fs.existsSync(path.join(ROOT_DIR, file))) {
    fs.copyFileSync(
      path.join(ROOT_DIR, file),
      path.join(PACKAGE_DIR, file)
    );
    console.log(`  - 已复制 ${file}`);
  }
});

// 创建 zip 归档
console.log('创建插件归档...');
const output = fs.createWriteStream(path.join(BUILD_DIR, `${PLUGIN_NAME}.zip`));
const archive = archiver('zip', {
  zlib: { level: 9 }
});

output.on('close', () => {
  console.log(`
✅ 打包完成！
  - 输出目录: ${BUILD_DIR}
  - 文件夹: ${PLUGIN_NAME}/
  - 压缩包: ${PLUGIN_NAME}.zip (${archive.pointer()} 字节)
  
可以通过以下方式在 Obsidian 中测试此插件:
1. 打开 Obsidian > 设置 > 第三方插件 > 打开插件文件夹
2. 创建文件夹 ${PLUGIN_NAME}
3. 将 build/${PLUGIN_NAME}/ 中的所有文件复制到新创建的文件夹中
4. 重启 Obsidian 并启用插件

或者:
1. 使用 BRAT 插件安装该插件，选择 "从存储库安装" 并使用本地 zip 文件路径
`);
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.warn('警告:', err);
  } else {
    throw err;
  }
});

archive.on('error', (err) => {
  throw err;
});

archive.pipe(output);
archive.directory(PACKAGE_DIR, PLUGIN_NAME);
archive.finalize(); 