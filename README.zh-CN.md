**简体中文** | [English](README.md)

# xmind-md-to-mindmap

把 **Markdown 转成思维导图 PNG**：直接复用 XMind 网页版**自己的** Markdown 转换器 + 官方布局渲染引擎
（snowmonster），命令行出图，免登录、不用打开网站界面。

> ⚠️ 非官方项目，仅供学习 / 研究，与 XMind 官方无任何关联。本仓库**不包含**任何 XMind 专有 JS 代码
> —— 工具在运行时会从 `app.xmind.cn` 拉取公开的前端 chunk 来调用。

## 能做什么

```bash
# 1) 安装依赖 playwright-core，并确保本机装了 Google Chrome
npm i

# 2) Markdown -> PNG（XMind 官方渲染），可选同时导出 .xmind
node xmind-md-to-mindmap/scripts/md2mindmap.mjs input.md -o out.png
node xmind-md-to-mindmap/scripts/md2mindmap.mjs input.md -o out.png --xmind out.xmind
node xmind-md-to-mindmap/scripts/md2mindmap.mjs - -o out.png < input.md   # 读 stdin
node xmind-md-to-mindmap/scripts/md2mindmap.mjs input.md --width 2000 --height 1200
```

支持标题层级、有序/无序嵌套列表、任务清单 `- [x]`、引用（变备注）、GFM 表格（变电子表格）、
图片、代码块、公式、行内富文本等。

## 原理（逆向所得）

官网的 Markdown 导入是**纯前端**完成的，核心是三个可复用的前端模块：

```
importMarkdownV3(md 字节)             -> .xmind（ArrayBuffer）
openDocWithInject(xmind, true)        -> { doc }（套默认主题/版本）
renderThumbnail(doc, { size })        -> PNG（官方 snowmonster 布局引擎）
```

工具用无头 Chrome 打开官网**公开登录页**当“运行时宿主”（有 `window.Manifests`/Vue 等全局），
再在这些模块里动态 `import` 并调用它们——因此**无需登录**，效果与官网导出同源。
官网 chunk 名带内容哈希，脚本每次运行会**自动从 entry 解析最新文件名**。

> 结论：官网并**没有**公开的「md → 图片」HTTP 接口（转换都在浏览器里做）；本项目“调官网接口”的实现方式，
> 就是复用它的前端转换器 + 官方渲染器。

## 仓库结构

```
.
├── xmind-md-to-mindmap/        # ⭐ 打包好的 skill
│   ├── SKILL.md
│   ├── scripts/md2mindmap.mjs   # 命令行工具本体
│   └── references/pipeline.md   # 逆向技术底稿（调用链/导出符号/排错）
└── xmind-md-reverse/            # 分析报告 + 参考实现
    ├── XMind-Markdown导入逆向分析.md   # 完整逆向报告
    ├── code/                    # ref-impl.mjs（纯 remark 复现状态机）、样例
    ├── demo/                    # example.md / example.png / example.xmind
    └── assets/                  # 管线图、自研渲染的思维导图
```

## 作为 agent skill 使用

把 `xmind-md-to-mindmap/` 拷到你的 skills 目录即可；也可以直接调用里面的脚本。

## 注意 / 限制

- 需要本机有 Google Chrome / Chromium，且能访问 `app.xmind.cn`（每次运行会拉官网 chunk）。
- Markdown 里的外链图片 `![]()` 官方渲染不会内嵌（对应节点会留空）。
- 若 XMind 发版改了 chunk 名/全局导致渲染为空：用 `MD2MM_DEBUG=1` 排查，或用
  `MD2MM_MARKDOWN_V3` / `MD2MM_IMPORT_FILE` / `MD2MM_SNOWMONSTER` 手动指定。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
