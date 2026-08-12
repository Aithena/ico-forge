# ICO Forge

在浏览器里本地处理图标：图片转多尺寸 `.ico`，以及纯色 PNG 转 SVG。

## 功能

### 图片转 ICO
- **网站 Favicon**：16 / 32 / 64（下载名为 `favicon.ico`）
- **Windows 应用图标**：16 / 32 / 64 / 128 / 256
- 可选预览各尺寸

### PNG 转 SVG
- 适合扁平、纯色、透明底的图标
- 本地描摹生成矢量 `.svg`

## 本地开发

```bash
npm install
npm run dev
```

开发地址：http://localhost:18808/ico-forge/

- ICO：`#/ico`
- PNG→SVG：`#/png-svg`

## 构建

```bash
npm run build
npm run preview
```

## 部署到 GitHub Pages

推送到 `main` 后由 Actions 自动部署：`https://aithena.github.io/ico-forge/`
