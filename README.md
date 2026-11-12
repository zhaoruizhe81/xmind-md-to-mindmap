# xmind-md-to-mindmap

Convert **Markdown → mind map PNG** by reusing XMind web's *own* Markdown converter + official
layout renderer (snowmonster), from the command line. No login, no website UI.

> ⚠️ Unofficial, for learning / research. Not affiliated with XMind. This repo does **not** include
> any XMind proprietary JS bundles — the tool fetches the public chunks from `app.xmind.cn` at runtime.

## What it does

```bash
# 1) install dep (playwright-core) + make sure Google Chrome is installed
npm i

# 2) Markdown -> PNG (official XMind rendering), optional .xmind
node xmind-md-to-mindmap/scripts/md2mindmap.mjs input.md -o out.png
node xmind-md-to-mindmap/scripts/md2mindmap.mjs input.md -o out.png --xmind out.xmind
node xmind-md-to-mindmap/scripts/md2mindmap.mjs - -o out.png < input.md   # stdin
node xmind-md-to-mindmap/scripts/md2mindmap.mjs input.md --width 2000 --height 1200
```

How it works (reverse-engineered): the site's Markdown import is **pure front-end**:

```
importMarkdownV3(md bytes)            -> .xmind (ArrayBuffer)
openDocWithInject(xmind, true)        -> { doc }
renderThumbnail(doc, { size })        -> PNG  (official snowmonster layout engine)
```

The CLI opens a headless Chrome on the site's public login page (which hosts the full runtime),
then dynamically imports and calls those official chunks — no auth needed. Chunk names are
content-hashed and auto-resolved from `entry.js` each run.

## Repo layout

```
.
├── xmind-md-to-mindmap/        # ⭐ the packaged skill
│   ├── SKILL.md
│   ├── scripts/md2mindmap.mjs  # the CLI
│   └── references/pipeline.md  # reverse-engineering notes
└── xmind-md-reverse/           # analysis + reference implementation
    ├── XMind-Markdown导入逆向分析.md   # full reverse report
    ├── code/                   # ref-impl.mjs (pure remark reimplementation), sample
    ├── demo/                   # example.md / example.png / example.xmind
    └── assets/                 # pipeline diagram, custom-render mind map
```

## Use as an agent skill

Copy `xmind-md-to-mindmap/` into your skills directory, or invoke its script directly.

## Notes / limitations

- Requires Google Chrome/Chromium and access to `app.xmind.cn` (fetches public chunks each run).
- External `![]()` image URLs are not embedded by the official renderer (node shows empty).
- If a XMind release changes chunk names/globals and rendering returns null, run with
  `MD2MM_DEBUG=1` and/or override `MD2MM_MARKDOWN_V3` / `MD2MM_IMPORT_FILE` / `MD2MM_SNOWMONSTER`.

## License

MIT — see [LICENSE](LICENSE).
