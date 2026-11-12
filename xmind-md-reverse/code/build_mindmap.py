# -*- coding: utf-8 -*-
"""渲染一张 XMind 风格的「中心主题 + 左右分支」思维导图 (SVG)。"""
import math, html, sys, subprocess, os

FN = "'Hiragino Sans GB','STHeiti','Songti SC',sans-serif"

# ---------------- 内容 ----------------
# 每侧：一级分支列表；节点 = (文本, [子节点...])
LEFT = [
    ("解析器配置", [
        ("remark-parse", []),
        ("remark-gfm", [("表格/任务/删除线", [])]),
        ("remark-math", []),
        ("禁用 codeIndented", []),
    ]),
    ("后处理", [
        ("折叠空包装", []),
        ("图片/公式上提", []),
        ("引用 → 备注", []),
        ("根节点折叠", []),
    ]),
]
RIGHT = [
    ("解析管线", [
        ("utf-8 解码", []),
        ("remark 解析", [("mdast 语法树", [])]),
        ("状态机遍历", [("Topic 树", [])]),
    ]),
    ("节点映射", [
        ("标题 → 层级", []),
        ("列表 → 子级", []),
        ("引用 → 备注", []),
        ("表格 → 电子表格", []),
    ]),
]
ROOT = "Markdown 转思维导图"

PALETTE = [
    dict(fill="#F87171", stroke="#EF4444", deep="#7F1D1D"),  # red
    dict(fill="#FB923C", stroke="#F97316", deep="#7C2D12"),  # orange
    dict(fill="#5EEAD4", stroke="#0D9488", deep="#134E4A"),  # teal
    dict(fill="#86EFAC", stroke="#22C55E", deep="#14532D"),  # green
]

# ---------------- 尺寸 ----------------
FS = {"root": 30, "1": 24, "2": 19, "3": 17}
H  = {"root": 78, "1": 58, "2": 46, "3": 42}
PADX, PADY = 26, 12
HGAP = 62
VGAP = 22
RADIUS = 14
MINW = {"root": 240, "1": 112, "2": 88, "3": 80}


def text_w(txt, fs):
    w = 0
    for ch in txt:
        w += fs * (1.03 if ord(ch) > 0x2E7F else 0.63)
    return w


def node_w(n):
    lvl = str(min(n["depth"], 3))
    return max(MINW[lvl], text_w(n["text"], FS[lvl]) + PADX * 2)


def node_h(n):
    lvl = "root" if n["depth"] == 0 else str(min(n["depth"], 3))
    return H[lvl]


def mix(c1, c2, t):
    c1 = c1.lstrip("#"); c2 = c2.lstrip("#")
    r1, g1, b1 = int(c1[0:2], 16), int(c1[2:4], 16), int(c1[4:6], 16)
    r2, g2, b2 = int(c2[0:2], 16), int(c2[2:4], 16), int(c2[4:6], 16)
    return "#%02X%02X%02X" % (round(r1 + (r2 - r1) * t),
                              round(g1 + (g2 - g1) * t),
                              round(b1 + (b2 - b1) * t))


def build_side(items, side, color_start):
    """把一侧的内容列表展开成节点森林，返回 (forest, maxW_by_depth)."""
    forest = []
    maxw = {}
    idx = color_start
    for text, children in items:
        col = PALETTE[idx % len(PALETTE)]
        idx += 1

        def mk(t, ch, depth, color):
            n = dict(text=t, depth=depth, side=side, color=color, children=[])
            n["children"] = [mk(ct, cch, depth + 1, color) for ct, cch in ch]
            return n

        n = mk(text, children, 1, col)
        forest.append(n)

    def walk(n):
        maxw[n["depth"]] = max(maxw.get(n["depth"], 0), node_w(n))
        for c in n["children"]:
            walk(c)
    for n in forest:
        walk(n)
    return forest, maxw


def block_height(n):
    if not n["children"]:
        return node_h(n)
    total = sum(block_height(c) for c in n["children"]) + VGAP * (len(n["children"]) - 1)
    return max(node_h(n), total)


def place(n, top, parent, root_w):
    h = block_height(n)
    n["w"] = node_w(n)
    n["h"] = node_h(n)
    n["cy"] = top + h / 2.0
    if parent is None:            # 一级分支：贴着中心节点
        if n["side"] == "R":
            n["x"] = root_w / 2 + HGAP
        else:
            n["x"] = -root_w / 2 - HGAP - n["w"]
    else:                          # 子分支：贴着父节点（每个子树独立展开，避免长直线）
        if n["side"] == "R":
            n["x"] = parent["x"] + parent["w"] + HGAP
        else:
            n["x"] = parent["x"] - HGAP - n["w"]
    if n["children"]:
        child_total = sum(block_height(c) for c in n["children"]) + VGAP * (len(n["children"]) - 1)
        cursor = top + (h - child_total) / 2.0
        for c in n["children"]:
            place(c, cursor, n, root_w)
            cursor += block_height(c) + VGAP


def collect(n, out):
    out.append(n)
    for c in n["children"]:
        collect(c, out)


def layout(forest, side, root_w, maxw):
    total = sum(block_height(n) for n in forest) + VGAP * (len(forest) - 1)
    cursor = -total / 2.0
    for n in forest:
        place(n, cursor, None, root_w)
        cursor += block_height(n) + VGAP
    nodes = []
    for n in forest:
        collect(n, nodes)
    return nodes


def main():
    root_w = max(MINW["root"], text_w(ROOT, FS["root"]) + 74)
    root_h = H["root"]

    lf, lmax = build_side(LEFT, "L", 2)
    rf, rmax = build_side(RIGHT, "R", 0)
    lnodes = layout(lf, "L", root_w, lmax)
    rnodes = layout(rf, "R", root_w, rmax)
    nodes = lnodes + rnodes

    # 画布范围
    xs = [n["x"] for n in nodes] + [n["x"] + n["w"] for n in nodes] + [-root_w/2, root_w/2]
    ys = [n["cy"] - n["h"]/2 for n in nodes] + [n["cy"] + n["h"]/2 for n in nodes] + [-root_h/2, root_h/2]
    margin = 48
    minx, maxx = min(xs) - margin, max(xs) + margin
    miny, maxy = min(ys) - margin, max(ys) + margin
    W, Hc = maxx - minx, maxy - miny

    def X(x): return x - minx
    def Y(y): return y - miny

    svg = []
    svg.append(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{Hc:.0f}" viewBox="0 0 {W:.0f} {Hc:.0f}">')
    svg.append('<defs>')
    svg.append('<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#0f172a" flood-opacity="0.12"/></filter>')
    svg.append('</defs>')
    svg.append(f'<rect x="0" y="0" width="{W:.0f}" height="{Hc:.0f}" fill="#ffffff"/>')

    # ---------- 连线 ----------
    def edge(p, c):
        if c["side"] == "R":
            x1, y1 = X(p["x"] + p["w"]), Y(p["cy"])
            x2, y2 = X(c["x"]), Y(c["cy"])
            dx = (x2 - x1)
            c1x, c1y = x1 + dx * 0.5, y1
            c2x, c2y = x2 - dx * 0.5, y2
        else:
            x1, y1 = X(p["x"]), Y(p["cy"])
            x2, y2 = X(c["x"] + c["w"]), Y(c["cy"])
            dx = (x1 - x2)
            c1x, c1y = x1 - dx * 0.5, y1
            c2x, c2y = x2 + dx * 0.5, y2
        col = c["color"]["stroke"]
        width = 4 if c["depth"] == 1 else 2.6
        return (f'<path d="M {x1:.1f} {y1:.1f} C {c1x:.1f} {c1y:.1f}, {c2x:.1f} {c2y:.1f}, {x2:.1f} {y2:.1f}" '
                f'fill="none" stroke="{col}" stroke-width="{width}" stroke-linecap="round" opacity="0.9"/>')

    # 先画所有边（在节点下层）
    edge_svg = []
    for n in rf:
        stack = [n]
        while stack:
            p = stack.pop()
            for c in p["children"]:
                edge_svg.append(edge(p, c))
                stack.append(c)
    for n in lf:
        stack = [n]
        while stack:
            p = stack.pop()
            for c in p["children"]:
                edge_svg.append(edge(p, c))
                stack.append(c)
    svg.extend(edge_svg)

    # ---------- 节点 ----------
    def draw_node(n):
        fill = n["color"]["fill"]
        if n["depth"] >= 2:
            fill = mix(n["color"]["fill"], "#FFFFFF", 0.42 if n["depth"] == 2 else 0.62)
        stroke = n["color"]["stroke"]
        lvl = str(min(n["depth"], 3))
        fs = FS[lvl]
        textcol = n["color"]["deep"] if n["depth"] == 1 else "#1F2937"
        x, y = X(n["x"]), Y(n["cy"] - n["h"] / 2)
        return (f'<g filter="url(#sh)"><rect x="{x:.1f}" y="{y:.1f}" width="{n["w"]:.1f}" height="{n["h"]:.1f}" '
                f'rx="{RADIUS}" ry="{RADIUS}" fill="{fill}" stroke="{stroke}" stroke-width="2.2"/></g>'
                f'<text x="{x + n["w"]/2:.1f}" y="{Y(n["cy"]) + fs*0.35:.1f}" text-anchor="middle" '
                f'font-family="{FN}" font-size="{fs}" fill="{textcol}" font-weight="600">{html.escape(n["text"])}</text>')

    for n in nodes:
        svg.append(draw_node(n))

    # ---------- 根节点 ----------
    rx, ry = X(-root_w / 2), Y(-root_h / 2)
    svg.append(f'<g filter="url(#sh)"><rect x="{rx:.1f}" y="{ry:.1f}" width="{root_w:.1f}" height="{root_h:.1f}" rx="16" ry="16" fill="#FFFFFF" stroke="#3B82F6" stroke-width="3"/></g>')
    svg.append(f'<text x="{X(0):.1f}" y="{Y(0) + FS["root"]*0.35:.1f}" text-anchor="middle" font-family="{FN}" font-size="{FS["root"]}" fill="#111827" font-weight="700">{html.escape(ROOT)}</text>')

    # 根节点右侧的 “+” 圆钮
    cx, cy = X(root_w / 2 + 20), Y(0)
    svg.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="15" fill="#3B82F6"/>')
    svg.append(f'<path d="M {cx-6:.1f} {cy:.1f} H {cx+6:.1f} M {cx:.1f} {cy-6:.1f} V {cy+6:.1f}" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>')

    svg.append('</svg>')
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "mindmap.svg")
    open(out, "w", encoding="utf-8").write("\n".join(svg))
    print("wrote", out, f"{W:.0f}x{Hc:.0f}")


if __name__ == "__main__":
    main()
