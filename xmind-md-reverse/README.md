# XMind Web「Markdown → 思维导图」逆向分析 + 命令行出图

对 `https://app.xmind.cn` 在线版「导入 Markdown → 思维导图」链路的逆向成果，并附一个**命令行工具**：
用**官网自己的转换器 + 官方布局渲染引擎**，把 `.md` 直接输出成**官方效果的思维导图 PNG**（并可同时导出 `.xmind`）。

## 一句话结论

- Markdown→思维导图在官网是**纯前端**完成的，**没有公开的 md→图片 HTTP 接口**；
- 但它把「解析 / 建树 / 渲染」都做成了可复用的前端模块。本工具在无头 Chrome 里**直接调用这些官方模块**——
  等于「逆向官网的接口，命令行调用」，产出与官网导出同源的图片。

底层调用链（逆向所得）：
```
Markdown 字节
  └─ markdown_v3.chunk  importMarkdownV3(bytes) ──▶ .xmind (ArrayBuffer)
       └─ import-file.chunk  openDocWithInject(xmind, true) ──▶ { doc }（套默认主题/版本）
            └─ snowmonster-ext  renderThumbnail(doc, {size}) ──▶ PNG (ArrayBuffer，官方布局引擎)
```

## 命令行出图（推荐）

```bash
# 依赖：本地装了 Chrome；能访问 app.xmind.cn（每次会拉官网 chunk）。
# playwright-core 已安装；如未装： npm i playwright-core

node cli/md2mindmap.mjs input.md                 # -> input.png
node cli/md2mindmap.mjs input.md -o out.png      # 指定输出
node cli/md2mindmap.mjs input.md --xmind out.xmind   # 顺便导出 .xmind
node cli/md2mindmap.mjs - -o out.png < input.md      # 读 stdin
node cli/md2mindmap.mjs input.md --width 2000 --height 1200
node cli/md2mindmap.mjs input.md --headful       # 调试：显示浏览器
```

要点：
- **无需登录**：脚本用无头 Chrome 打开官网公开页（登录页）当“运行时宿主”，再动态 `import` 官方 chunk 调用。
- **自动跟随发版**：官网 chunk 名带内容哈希，脚本会从 `entry.js` 自动解析当前 `markdown_v3 / import-file / snowmonster-ext` 文件名；也可用环境变量 `MD2MM_MARKDOWN_V3`、`MD2MM_IMPORT_FILE`、`MD2MM_SNOWMONSTER` 覆盖，`MD2MM_NO_DISCOVER=1` 关闭自动发现。
- 环境变量：`CHROME_PATH` 指定 Chrome；`XMIND_ORIGIN` 指定站点；`MD2MM_DEBUG=1` 打印解析到的模块名。

示例产物见 `demo/example.png`（输入 `demo/example.md`）。

## 目录结构

```
xmind-md-reverse/
├── README.md                         本索引
├── XMind-Markdown导入逆向分析.md      主报告（原理、映射表、标题算法、后处理、证据行号）
├── cli/
│   ├── md2mindmap.mjs                ★ 命令行：md → 官方渲染 PNG(+xmind)
│   └── _scratch/                     逆向过程的探针脚本（可删）
├── demo/
│   ├── example.md / example.png / example.xmind
├── assets/                           pipeline.png/.dot、mindmap.png/.svg（自定义渲染器产物）
├── code/                             参考实现（纯 remark 复现状态机）
│   ├── ref-impl.mjs / run.mjs / sample.md
│   └── build_mindmap.py              自研 SVG 渲染器（离线、无需官网/登录）
├── web-bundles/                      抓取的官方 JS（核心：markdown_v3.* ；渲染：snowmonster-ext.*）
├── _inspect/                         调试截图（可删）
└── package.json / node_modules       依赖
```

## 两种出图方式对比

| 方式 | 命令 | 效果 | 依赖 |
|---|---|---|---|
| **官网渲染（推荐）** | `node cli/md2mindmap.mjs in.md -o out.png` | 与 XMind 官网导出**同源**（官方 snowmonster 布局/配色） | Chrome + 访问 app.xmind.cn |
| 自研离线渲染 | `python3 code/build_mindmap.py` | 自定义风格，可完全离线 | Python + graphviz/rsvg |

## 核心转换规则（详见主报告）

标题层级 → 主题层级；列表 → 子级（有序自动编号、`- [x]` 变任务）；`> 引用` → 备注；
`|表格|` → 电子表格；`![]()` → 图片主题；`[..](url)` → 超链接；`**粗**/*斜*/~~删~~` → 富文本；
` ```代码``` ` → 代码主题；`$$公式$$` → MathJax 扩展。

## 关键证据（beautified `web-bundles/markdown_v3.pretty.js`）

| 行 | 内容 |
|---|---|
| L7703 / L7709 | `Markdown2XMind` 类 + 装配 remark（gfm/math/禁用 codeIndented） |
| L7712 | `convert()`：解码 → parse → createSheet → traverseRoot |
| L7763 / L7789 | 标题最浅深度归一化 / `createHeadingTopic` 三分支建树 |
| L7804 | `traverseNode` 巨型 switch（节点↔主题映射） |
| L8061 | `postProcess` 6 轮后处理 |

主报告：[`XMind-Markdown导入逆向分析.md`](XMind-Markdown导入逆向分析.md)
