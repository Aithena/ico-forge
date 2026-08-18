# 图片工具箱

在浏览器里本地处理图片：转 ICO、描摹 SVG、转 Base64、裁剪、水印、清晰化、取色，以及二维码 / 条形码。全程不上传服务器。

仓库名：`img-tools`。

## 功能

- **图片转 ICO**：网站 Favicon（16 / 32 / 64）或 Windows 应用图标（16–256）
- **PNG 转 SVG**：适合扁平、纯色、透明底的图标
- **转 Base64**：PNG 图标转 Data URI，去掉元数据、无损压紧
- **点选取色**：点击图片复制颜色
- **加水印**：文字或图片水印
- **图片清晰化**：本地锐化增强
- **图片裁剪**：常用比例与圆形头像
- **二维码 / 条形码**：生成与识别

## 本地开发

```bash
npm install
npm run dev
```

开发地址：http://localhost:18808/img-tools/

- ICO：`#/ico`
- PNG→SVG：`#/png-svg`
- 转 Base64：`#/base64`
- 点选取色：`#/color-pick`
- 加水印：`#/watermark`
- 图片清晰化：`#/clarity`
- 图片裁剪：`#/crop`
- 二维码：`#/qr`

## 构建

```bash
npm run build
npm run preview
```

## 部署到 GitHub Pages

推送到 `main` 后由 Actions 自动部署：`https://aithena.github.io/img-tools/`
