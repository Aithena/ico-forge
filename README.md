# ICO Forge

在浏览器里把图片转成多尺寸 `.ico`，全程本地处理，不上传服务器。

## 功能

- **Windows 应用图标**：16 / 32 / 48 / 256
- **网站 Favicon**：16 / 32（可选 48）
- 适配方式：完整放入（留白）或居中裁切
- 导出前预览各尺寸

## 本地开发

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
npm run preview
```

生产构建的 `base` 为 `/ico-forge/`，对应 GitHub Pages 项目站点路径。

## 部署到 GitHub Pages

1. 推送到 `main`（已配置 Actions 工作流 `.github/workflows/deploy.yml`）
2. 仓库 **Settings → Pages → Build and deployment** 选择 **GitHub Actions**
3. 部署完成后访问：`https://<你的用户名>.github.io/ico-forge/`

当前远程示例：`https://aithena.github.io/ico-forge/`
