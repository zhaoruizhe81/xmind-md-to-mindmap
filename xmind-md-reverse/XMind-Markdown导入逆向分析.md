# XMind Web 版「把 Markdown 变成思维导图」逆向分析

> 目标：`https://app.xmind.cn`（XMind 在线版）导入弹窗里的 **Markdown → 思维导图** 这一条链路。
> 结论先行：它不是「AI 理解」，而是一条**确定性的编译器管线**：
> `Markdown 文本 → UTF-8 字节 → remark(mdast) 语法树 → 手写状态机遍历 → XMind Topic 树（工作簿 JSON）`。
> 也就是说，**Markdown 的结构语法本身（标题层级 / 列表嵌套 / 引用 / 表格…）就是思维导图的结构**，XMind 只是把每种语法节点「翻译」成对应的主题节点。

---

## 0. 一句话看懂

Markdown 天生是一棵「标题 + 列表」的树；XMind 只要：

1. 用 **remark** 把 Markdown 解析成标准 **mdast 抽象语法树**；
2. 用一个**带栈的状态机**遍历这棵树，把 `heading/list/listItem/blockquote/table/code/image/strong…` 逐个映射成 XMind 的 `Topic`（标题、子主题、备注、标签、图标、扩展）；
3. 出栈/收尾时做几轮**后处理**（折叠单层包装、把图片/引用/任务信息上提等），得到 `.xmind` 的内部 `content.json`。

所以「支持多少种格式」靠的是**每种格式各写一个 importer，最后都归一到同一个 `Topic` 树模型**；Markdown 只是其中一个 importer（`importMarkdownV3`）。

---

## 1. 我做了什么（可复现的抓取定位过程）

站点是 Vite/Rolldown 打包的 SPA，入口 `app-cn.entry.DjyYIv5I.js`。顺着入口里对 `import-file-dialog` 的引用一路挖到 Markdown 转换器：

```bash
# 1) 首页拿入口 script
curl -sSL https://app.xmind.cn/home/recents/_kzvaq_PhAyVBvtPa -o home.html
# 入口: /app-cn.entry.DjyYIv5I.js

# 2) 入口里搜 markdown / import
grep -oiE '.{40}markdown.{40}' entry.js
# → markdown.chunk.DtuI4T3O.js 路由, importMarkdownV3(e)

# 3) 真正的转换器在 markdown_v3.chunk
curl -sSL https://app.xmind.cn/markdown_v3.chunk.CSQo9SQm.js -o markdown_v3.chunk.CSQo9SQm.js   # 168KB
npx js-beautify markdown_v3.chunk.CSQo9SQm.js -o markdown_v3.pretty.js                          # 8467 行

# 4) 各 importer 的注册表（11 种格式都在这）
curl -sSL https://app.xmind.cn/import-file.chunk.W4qCciBn.js -o import-file.chunk.js
```

关键文件与大小：

| 文件 | 作用 |
|---|---|
| `app-cn.entry.DjyYIv5I.js` (282KB) | SPA 入口 |
| `import-file-dialog.chunk.uUBdMI_F.js` (2.9KB) | 导入弹窗逻辑，调 `openImportFileDialog` |
| `import-file.chunk.W4qCciBn.js` (6.8KB) | **importer 注册表**：xmind/mmap/mm/lighten/emmx/md/opml/itmz/mind/docx/textbundle |
| `markdown.chunk.DtuI4T3O.js` (1.9KB) | Markdown 转换路由；`TextEncoder().encode(text)` → `importMarkdownV3` |
| **`markdown_v3.chunk.CSQo9SQm.js` (168KB)** | **核心：Markdown → Topic 树，全部逻辑在这里** |
| `markdown.chunk.Bhjxl5WS.js` (9.1KB) | 反向：Topic 树 → Markdown（导出，非本次重点） |

> 说明：页面本身是登录态 SPA，但资源是**公开静态 chunk**，直接按文件名抓取即可，无需登录。所有逻辑为纯前端（浏览器内完成），不上传服务器转换。

---

## 2. 整体管线（Markdown 分支）

![XMind Markdown 导入管线](assets/pipeline.png)

```mermaid
flowchart LR
  A[用户拖入 .md 文件 / 粘贴文本] --> B[File.arrayBuffer 或 TextEncoder.encode]
  B --> C[TextDecoder utf-8 解码成字符串]
  C --> D[remark 解析器<br/>unified + remark-parse + gfm + math]
  D --> E[mdast 抽象语法树 Root]
  E --> F[Markdown2XMind.convert<br/>状态机遍历 traverseRoot]
  F --> G[XMindBuilder.content.createSheet<br/>生成 Topic 树 / Sheet]
  G --> H[.build 得到工作簿 document]
  H --> I[套默认主题 + 写 DataStructureVersion=3]
  I --> J[打包成 .xmind / 直接建文件]
```

对应代码（`markdown_v3.pretty.js`）：

```js
// Wc = Markdown2XMind 类；构造函数里装配 remark 解析器   (line 7703-7710)
this.remark = qi()
    .use($o)                 // remark-gfm 等价：autolink/footnote/strikethrough/table/tasklist
    .use(ds)                 // remark-math 等价：$...$ 与 $$...$$
    .use(ps(['codeIndented'])); // 关闭「缩进代码块」语法（关键！见 §3）

// convert() (line 7712-7738)
t = new TextDecoder('utf-8');
n = t.decode(new Uint8Array(this.rawData));  // 字节 → 字符串
r = this.remark.parse(n);                     // 字符串 → mdast
i = this.xmindBuilder.content.createSheet();  // 目标：一个空白 Sheet
await this.traverseRoot(r, i);                // 遍历 mdast 填充 Topic
// ...
return this.xmindBuilder;                     // 之后 .build() 出工作簿
```

导入口（`markdown.chunk.DtuI4T3O.js`）：

```js
const { importMarkdownV3 } = (await import('./markdown_v3.chunk.CSQo9SQm.js').then(e => e.r));
const doc = (await importFile(await importMarkdownV3(new TextEncoder().encode(markdownText)), true)).doc;
const thumbnail = await renderThumbnail(doc, { size:{width:1920,height:1080} });
const xmindFile = await packXmind(doc, { thumbnail, stage:null });
```

---

## 3. 解析器配置：为什么是 remark，且关掉「缩进代码块」

`qi()` 先装 `remark-parse`(解析) + `remark-stringify`(序列化) 两个基础插件（line 4818），再挂三组扩展：

| 插件 | 作用 | 在代码里 |
|---|---|---|
| `remark-gfm` | 表格 `table`、任务列表 `- [x]`、删除线 `~~`、自动链接、脚注 | `$o` → `Zo()` = `[自动链接, 脚注, 删除线, 表格, 任务列表]` (line 6301) |
| `remark-math` | 行内 `$..$` 与块级 `$$..$$` 数学公式 | `ds` (line 6633) |
| **禁用 `codeIndented`** | **把「4 空格缩进 = 代码块」这条语法关掉** | `ps(['codeIndented'])` (line 6647) |

> **为什么关掉缩进代码块？** 因为在普通 Markdown 里，缩进 4 空格会被解析成 `<pre><code>` 代码块。但用户从 Word/大纲/随手笔记里粘贴的文本，经常用缩进来表示**层级**。XMind 关掉这条规则，就能把「缩进」更多地当成**列表嵌套**，避免整段被误判成代码块。这是一个很实用的工程取舍。

`markMarkdownSyntaxDetected`（line 7498-7511）：遍历过程中只要见到任一「真正的 Markdown 语法节点」（标题/加粗/列表/表格/引用/链接/图片/代码/公式…），就标记 `markdownSyntaxDetected = true`；用于最后判断「这其实是一段纯文本，还是真的 Markdown」，纯文本会走占位根主题逻辑。

---

## 4. 核心数据结构：一个「栈驱动」的建树器

核心是类 `Rc`（line 7492），它维护了所有遍历状态：

```js
topicStack            // 当前路径上的 Topic 栈（栈顶=当前主题）
listTypeStack         // 有序/无序列表类型栈
zoneInfoStack         // Zone（概要框）栈
parentTopicsOfSublists// 记录「承载子列表的父主题」（后处理要折叠）
parentTopicsOfTables  // 记录「承载表格的父主题」
topicPairsOfImages/Maths/Blockquotes/TaskInfos // 待上提配对
minimumHeadingDepth   // 本文档里最浅的标题级别（用于归一化）
leadingParagraphParsed// 首个段落是否已吃掉
currentHeadingInListTopic
currentText / currentBold / currentItalic / currentStrikethrough / currentUnderline
attributedTitle / notesText / href / image / ...
handlingTable / handlingTableHeader / currentTableHeaders / currentTableColumnIndex
```

两个最关键的取值方法：

```js
currentTopic()        = topicStack栈顶 || sheet.rootTopic
parentOfCurrentTopic() = currentTopic().parent || sheet.rootTopic
```

`commitTopic()`：把累积的 `attributedTitle`（富文本片段）、`notes`、`href`、`image`、`extensions` 写进当前 Topic，并用拼接文本生成 `title`。
`commitDanglingTopicAndReset()`：遇到新的块级结构时，把「悬挂」的当前主题提交并清空所有累积状态。

---

## 5. 遍历机制：enter / leave 两阶段 + 节点分类

`traverseNodeRecursive`（line 8267）根据节点类型决定遍历方式：

```js
isEnterOnlyNode(e)  → 'heading'                     // 标题：只进不出（自带子节点=行内文本）
shouldSkipChildren(e) → 'blockquote'                // 引用：进+出，子节点不逐个遍历（整体序列化成备注）
hasEnterLeavePhases(e) → paragraph/list/listItem/
   strong/emphasis/delete/link/table/tableRow/tableCell   // 有进入和离开两个阶段
其余 → 只 enter，然后递归 children
```

留意图：`traverseNode(node, state, root, 'enter' | 'leave')` 是整个转换的心脏（line 7804，超大 switch）。

---

## 6. 完整映射表：mdast 节点 → XMind Topic 行为

这是「Markdown 怎么变成导图」的核心答案。按代码逐条整理：

| mdast 节点 | enter（进入） | leave（离开） | XMind 结果 |
|---|---|---|---|
| `heading` `#..######` | 计算层级建主题（见 §7）；在**有序列表**里→先把自己从父级摘除再建；在**无序列表**里→**不建标题**，而是把 `###` 当字面文本追加到当前文本 | — | 标题层级 = 主题层级 |
| `paragraph` | 首段且栈空→作为**根(中心)主题**；在列表内→追加 `\n\n`；否则在 currentTopic 下**新建子主题**并入栈 | 不在列表→提交并**出栈** | 一个段落 = 一个主题（首段=中心主题） |
| `list` | commitDangling，push 列表类型（ordered/unordered） | pop 列表类型 | 只切换上下文，不建节点 |
| `listItem` | 在 `currentHeadingInListTopic||currentTopic` 下建子主题；有序→打 `numbering` 扩展；有 `checked`→打 `task` 扩展(done/todo)；嵌套→父主题记入 `parentTopicsOfSublists` | commitDangling，出栈 | 每个列表项 = 一个主题；有序自动编号；`- [x]` 变任务图标 |
| `blockquote` `> ` | commitDangling，记为当前引用块 | 把引用块子节点**用 remark.stringify 序列化**成文本，塞进子主题的 `notes`；记录配对 | **引用 → 备注(notes)**（不上树，最后上提给前一个主题） |
| `math` `$$..$$` | 建子主题 + `mathJax` 扩展 | 出栈 | 块级公式 → 带公式扩展的主题 |
| `inlineMath` `$..$` | 文本里追加 `$value$` | — | 行内公式 → 字面文本 |
| `image` `![..](url)` | 建子主题，`image=url`（若文件在 zip 里则内嵌二进制）；记录配对 | 出栈 | 图片主题；后处理会把图片**上提到前面无图主题**（见 §8） |
| `link` `[t](url)` | `href=url` | — | 链接 → 主题的 `href` 超链接 |
| `strong` `**x**` | 提交现有文本，`bold=true` | 提交文本，`bold=false` | 富文本片段 `font-weight:700` |
| `emphasis` `*x*` | `italic=true` | `italic=false` | 富文本片段 `font-style:italic` |
| `delete` `~~x~~` | `strike=true` | `strike=false` | 富文本片段 `text-decoration:line-through` |
| `html` | `<u>/<ins>`→下划线开关；`<!-- Zone/pos/zone -->`→概要与坐标；其它当文本 | — | 下划线 + XMind 私有注释（往返保真） |
| `text` | 追加到 currentText | — | 主题文本 |
| `break` | 追加换行 | — | 主题内换行 |
| `code` ```` ``` ```` | 普通代码→建独立子主题，文本=整段 fenced code；`xmind-task-info`→解析 JSON 成任务扩展；`mermaid`+选项→转成子图 | — | 代码块 → 代码主题 / 任务 / 子导图 |
| `inlineCode` | 追加 `` `value` `` | — | 行内代码字面量 |
| `table` | 建子主题并设 `structureClass = 电子表格` | 写 `columns` 表头扩展，出栈 | 表格 → XMind「电子表格结构」 |
| `tableRow` | 非表头行重置列索引 | 表头行结束→关表头；数据行→提交出栈 | 每行一个主题 |
| `tableCell` | 表头→压入单元格主题；数据→在行主题下建子主题 | 表头→收集表头名；数据→**非首列打上「列名」标签** | 首列=行标题，其余列=带列名标签的子主题 |
| `thematicBreak`/`definition`/`yaml`… | 标记「是 Markdown」，基本忽略 | — | — |

> 一句话记忆：**标题→层级，列表→子级+编号/任务，引用→备注，表格→电子表格，图片→图片主题(可上提)，链接→超链接，加粗斜体删除→富文本，代码→代码主题，公式→公式扩展。**

---

## 7. 标题层级算法（最容易被误解的地方）

### 7.1 先算「最浅标题级别」做归一化
`calculateMinimumHeadingDepth(root)`（line 7763）：扫描全树所有 `heading`，取**最小 depth**；没有标题则为 `6`。

> 效果：文档如果从 `##` 开始，`##` 会被当成第 1 层（中心主题的第一个子级），而不是空两层。**不要求从 `#` 开始**。

### 7.2 再按层级建树
`createHeadingTopic(state, node)`（line 7789）：

```js
n = node.depth - minimumHeadingDepth   // 归一化后的目标层级(0-based)
r = topicStack.length - 2              // 当前所在主题的层级(0-based)

if (n === r)  // 同级 → 兄弟
    parent = parentOfCurrentTopic(); 建主题; 先 pop 再 push
else if (n > r) // 更深 → 子级
    parent = currentTopic(); 建主题; push
else {          // 更浅 → 一路弹栈回到目标父级
    while (depth - minDepth < topicStack.length - 1) pop();
    parent = currentTopic(); 建主题; push;
}
```

**举例**（minDepth=1）：

```
# 产品规划          → 第0层（中心主题）
## 市场分析         → 第1层（子级）
### 机会点          → 第2层（市场分析的子级）
## 技术方案         → 第1层（回到与市场分析同级）
```

这三行恰好对应经典栈操作：`#`建根、`##`更深 push、`###`更深 push、再一个`##`弹回同级。整个导图就是 Markdown 标题的**缩进大纲**。

**两个边界行为**（line 7804 的 case 3-22）：
- 标题出现在**有序列表**里 → 会先把自己从父主题摘除、出栈，然后当标题处理（避免标题被塞进列表项）。
- 标题出现在**无序列表**里 → 反而不当标题，直接变成 `###` 字面文本追加到当前列表项文本（防止在列表里乱建层级）。

---

## 8. 后处理（postProcess）：真正「像原生导图」的关键

遍历完只是一棵「语法直译」的树，`postProcess`（line 8061）再做 6 轮整形，去掉翻译过程产生的「空包装」，并把信息放到正确的语义位置：

1. **折叠子列表包装主题**（`parentTopicsOfSublists`）
   当某个承载子列表的父主题只有 1 个子主题、且自己无标题/无备注/无图片时，把子主题的内容「提升」到父主题（避免出现一串空的中间层）。
2. **折叠表格包装主题**（`parentTopicsOfTables`）
   承载电子表格的父主题若只有一个电子表格子主题，同样上提 `structureClass` 与子节点。
3. **图片上提**（`topicPairsOfImages`）
   若「占位图片主题」有图、而它的前一个主题无图 → 把图片挪到前一个主题并删掉占位主题。
   （所以单独一行 `![](a.png)` 会贴着上一段文字变成「带图的主题」，而不是凭空多一个空节点。）
4. **公式上提**（`topicPairsOfMaths`）：同图片逻辑，把 mathJax 扩展上提到前一个主题。
5. **引用备注上提**（`topicPairsOfBlockquotes`）：把引用生成的子主题的 `notes` 合并进前一个主题的备注，并删掉子主题 → **`> 引用` 直接成为那句主题的备注**。
6. **任务信息上提**（`topicPairsOfTaskInfos`）：`xmind-task-info` 代码块解析出的任务扩展，替换/合并到前一个主题。

最后还有两条「根节点」规则：
- **根折叠**：根只有 1 个子主题且根自身无内容 → 用那个子主题替换根（让 `# 标题` 直接成为中心主题，而不是挂在一个人造根下面）。
- **根多行拆分**：根只有单个标题、无子节点、且标题里含换行 → 按 `\n` 拆成一排同级子主题。
- **占位中心主题**：若根最终无标题但有内容 → 命名为 `Central Topic`。

---

## 9. 富文本与 XMind 私有扩展（往返保真）

- **富文本**：`commitTextSpan()` 把当前文本连同 `bold/italic/strikethrough/underline` 状态压成一个 span；`commitTopic()` 写进 `attributedTitle`，粗体映射 `font-weight:700`、斜体 `font-style:italic`、删除线 `text-decoration:line-through`。（Markdown 没有下划线，故用 `<u>/<ins>` HTML 标签补。）
- **任务**：`- [x]/[ ]` → 扩展 `org.xmind.ui.task`，`status: done|todo`；`xmind-task-info` 代码块可携带 `progress/start/due/priority/assignee`。
- **有序编号**：有序列表 → 扩展 `org.xmind.ui.numbering`，`pattern: numeral-arabic`。
- **表格**：`structureClass = org.xmind.ui.spreadsheet`，表头写成 `columns` 扩展（首列=`leading-column`，其余=`column`）。
- **公式**：`org.xmind.ui.mathJax` 扩展，内容为去掉 `$$` 的 LaTeX。
- **往返注释**：XMind 自己导出的 Markdown 会写入 `<!-- Zone: ... -->`、`<!-- Zone End: ... -->`、`<!-- ::xmind-pos:{x,y} -->`、`<!-- ::xmind-zone:{x,y,w,h} -->` 这类隐藏注释；再导入时据此还原**概要框、画布坐标**，实现「导出再导入」不丢布局。

---

## 10. 我自己复现验证了这套规则（可运行）

为了验证上面的映射不是纸上谈兵，我按**完全相同的状态机**（用同样的 `unified + remark-parse + remark-gfm` 解析）写了一份参考实现，跑一份覆盖各种语法的样例，输出如下真实结果：

**输入**（节选）：`# 产品规划` / 段落 / `## 市场分析` / 有序无序嵌套列表 / `- [x]` / `### 机会点` + `> 引用` / `## 技术方案` / 有序列表 / 表格 / 图片 / 代码块 / 加粗斜体删除链接。

**输出（主题树）**：

```
• 产品规划
  • 这是开篇段落。
  • 市场分析
    • 竞品 A
    • 竞品 B
      • 细节 1
        • 子项甲   «numbering»
        • 子项乙   «numbering»
    • 已完成项   «task(done)»
    • 待办项     «task(todo)»
    • 机会点     «notes = "引用会被变成备注\n第二行"»
  • 技术方案
    • 架构设计   «numbering»
    • 实现路径   «numbering»
      • 模块 X
    • (表格主题) «structure=spreadsheet; columns=名称/负责人/状态»
      • 登录
        • 张三     «labels=["负责人"]»
        • 进行中   «labels=["状态"]»
      • 支付
        • 李四     «labels=["负责人"]»
        • 完成     «labels=["状态"]»
    • (图片主题) «image=https://example.com/arch.png»
    • ```js\nconsole.log('hi')\n```
    • 加粗重点 与 斜体 和 删除 以及 XMind 链接
        «rich: 加粗重点[font-weight:700] / 斜体[italic] / 删除[line-through] / href=https://xmind.cn»
```

这与你实测导入 XMind 的结果一致：**标题成层级、有序列表带编号、`[x]` 变任务、引用变备注、表格变电子表格、图片单独成图主题、行内样式保留**。

复现文件：
- `code/ref-impl.mjs` —— 完整状态机参考实现（含 6 轮 postProcess）
- `code/sample.md` —— 覆盖各语法的测试样例
- `code/run.mjs` —— 运行并打印树 / JSON（在项目根：`npm i unified remark-parse remark-gfm remark-stringify && node code/run.mjs`）

---

## 11. 关键证据索引（beautified `markdown_v3.pretty.js`）

| 位置 | 内容 |
|---|---|
| L4818 | `qi = unified().use(remarkParse).use(remarkStringify).freeze()` |
| L6301 `$o` | remark-gfm（autolink/footnote/strikethrough/table/tasklist） |
| L6633 `ds` | remark-math |
| L6647 `ps` | 生成「禁用 codeIndented」的 micromark 扩展 |
| L7492 `Rc` | 建树器状态类（topicStack/listTypeStack/…全部状态） |
| L7703 `Wc` | `Markdown2XMind` 类；L7709 装配 remark |
| L7712 `convert` | 字节→解码→parse→createSheet→traverseRoot |
| L7740 `traverseRoot` | 入口遍历 + 最小标题深度 + 收尾 commit + postProcess |
| L7763 `calculateMinimumHeadingDepth` | 标题层级归一化 |
| L7789 `createHeadingTopic` | 标题三分支建树（兄弟/子级/弹栈） |
| L7804 `traverseNode` | 巨型 switch：每种节点的 enter/leave 映射 |
| L8061 `postProcess` | 6 轮后处理 + 根折叠/拆分 |
| L8267 `traverseNodeRecursive` | enter/leave 调度 + 节点分类 |
| L8346 `Gc` / L8350 `Kc` | `Markdown2XMind` 包裹 / `importMarkdownV3` 导出 |

（`import-file.chunk.W4qCciBn.js` 里可看到 11 种格式的注册表 `p = { xmind, mindmanager, freemind, lighten, mindmaster, markdown, opml, ithoughts, mindmeister, textbundle, word }`，每种 importer 都归一到一个 `Topic` 树——这就是「一套模型吃下所有格式」的架构。）

---

## 12. 怎么自己验证 / 继续挖

1. 打开 `https://app.xmind.cn`，F12 → Network，导入一个 `.md`，过滤 `markdown_v3`，看它加载的 chunk。
2. 把 `markdown_v3.chunk.*.js` 下载 → `npx js-beautify` → 按上面的行号读 `traverseNode` 的 switch。
3. 想拿到「真实内部 JSON」：在页面 console 里
   ```js
   const m = await import('https://app.xmind.cn/markdown_v3.chunk.CSQo9SQm.js');
   const wb = await m.r.importMarkdownV3(new TextEncoder().encode('# 标题\n- a\n- b'));
   console.log(JSON.stringify(wb, null, 2)); // 看真实 Topic 树/工作簿结构
   ```
4. 想扩展其它格式：看 `import-file.chunk` 里对应 `importXMind/importOPML/importDocx/...` 的 chunk，套路完全一样——**各自 parse → 同一套 Topic 模型**。

---

### 附：给非技术读者的一句话总结
XMind 把 Markdown 变成思维导图，本质是**「按 Markdown 的书写格式自动排版」**：
`#` 的个数决定它是第几层分支，`-`/`1.` 的缩进决定谁是谁的子项，`>` 自动变成备注，`|表格|` 自动变成电子表格，`![]()` 自动变成配图。它读懂的不是「你的意思」，而是**你写的语法结构**。所以只要按规范的 Markdown 大纲来写，导入出来就是一棵整齐的导图。

---

## 13. 附：命令行直接复用官网（新方向）

### 13.1 先泼个冷水：没有公开的 md→图片 HTTP 接口
Markdown 导入是**纯前端**完成的（见 §2–§11）。官网里唯一和「Markdown 转换」相关的服务端路由是
`/markdown/:taskId`，它本质是一个**内嵌 iframe 页面**：父窗口通过 `postMessage` 发
`{type:'convert-markdown', value:<md文本>, channel:<taskId>}`，页面内用 `importMarkdownV3` 转成 `.xmind`，
再 `renderThumbnail` 渲染缩略图，回发 `{type:'markdown-converted', value:{xmindFile, thumbnail}}`
（见 `web-bundles/post-message-event-channel.chunk.*.js`）。
但该路由受登录守卫，未登录会跳登录页——所以**不能当成匿名 HTTP 接口直接用**。

### 13.2 但可以直接「调用官网的模块」
真正的转换/渲染能力都在公开的静态 chunk 里，可被任意页面 `import` 调用：

| 模块 | 导出 | 作用 |
|---|---|---|
| `markdown_v3.chunk` | `r.importMarkdownV3(bytes)` | Markdown 字节 → **`.xmind`（ArrayBuffer）** |
| `import-file.chunk` | `o(xmind, true)` = `openDocWithInject` | `.xmind` → `{ doc }`（套默认主题、写 DataStructureVersion=3） |
| `snowmonster-ext.chunk` | `_(doc,{size})` = `renderThumbnail` | doc → **官方布局渲染的 PNG（ArrayBuffer）** |
| `snowmonster-ext.chunk` | `d(doc,{thumbnail})` = `packXmind` | 重新打包 `.xmind` |

`renderThumbnail`（`K`，snowmonster-ext 美化版 L408）= 起一个离屏 editor → `exportSVGElementWithSize` 出整图 SVG → 光栅化成 PNG（默认 UPNG 编码）。这就是官网「导出图片」同款引擎。

### 13.3 落地：`cli/md2mindmap.mjs`
手法：无头 Chrome 打开官网**公开登录页**当「运行时宿主」（此时 `window.Manifests`、Vue、图标等运行时齐全），
在页面上下文里动态 `import` 上面三个 chunk 并顺序调用：

```js
const xmind   = await mdmod.r.importMarkdownV3(new TextEncoder().encode(md)); // .xmind
const { doc } = await ifm.o(xmind, true);                                     // 套主题
const png     = await sm._(doc, { size: { width: 1600, height: 1000 } });     // 官方渲染 PNG
```

- **无需登录**；chunk 文件名带内容哈希，脚本会从 `entry.js` 自动解析最新名（可被 `MD2MM_*` 环境变量覆盖）。
- 用法：`node cli/md2mindmap.mjs input.md -o out.png [--xmind out.xmind] [--width N --height N]`。
- 产物示例：`demo/example.md` → `demo/example.png`（1600×1000，官方 snowmonster 布局/配色）。

> 结论：所谓「用官网的接口」，落到这条链路上就是**调用官网的前端转换器 + 渲染器**；命令行封装后即可 `md → 思维导图图片`，效果与官网导出一致。
