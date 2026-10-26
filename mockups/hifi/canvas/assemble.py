#!/usr/bin/env python3
"""Inline the rendered Anatomy SVGs (figures-out/figures.json) and shared partials into the artboard templates.
src/<Name>.dc.html  ->  project/<Name>.dc.html
Markers:  <!--CSS-->  <!--TOPBAR:projects|lab-->  <!--FIG:name@width-->  <!--DELTA-->  <!--ASK:scope|placeholder-->
"""
import json, re, sys, pathlib

HERE = pathlib.Path(__file__).resolve().parent
FIGS = json.loads((HERE.parent / "figures-out" / "figures.json").read_text())
CSS = (HERE / "src" / "_base.css").read_text() + "\n" + (HERE.parent / "figures-out" / "iso.css").read_text()

SEARCH = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" fill="none" stroke="#1b1a17" stroke-width="1.5"/><path d="M13 13l5 5" stroke="#1b1a17" stroke-width="1.5" stroke-linecap="round"/></svg>'
MARK = '<svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path d="M15 3 27 9.5 15 16 3 9.5Z" fill="#fff" stroke="#1b1a17" stroke-width="1.2" stroke-linejoin="round"/><path d="M3 9.5V20.5L15 27V16M27 9.5V20.5L15 27" fill="#ece2c8" stroke="#1b1a17" stroke-width="1.2" stroke-linejoin="round"/><path d="M15 16 27 9.5V20.5L15 27Z" fill="#6fd0df" fill-opacity=".55"/></svg>'
SEND = '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 15V3M4 8l5-5 5 5" fill="none" stroke="#f5f4ef" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'


def topbar(active):
    on = lambda k: ' class="on" aria-current="page"' if k == active else ""
    return f'''<header class="bar">
<a class="brand" href="Main.dc.html">{MARK}<div><b>Common Bench</b><span>Meridian Dental Materials</span></div></a>
<nav class="nav" aria-label="Main">
<div class="seg"><a href="Main.dc.html"{on("projects")}>Projects</a><a href="Lab.dc.html"{on("lab")}>Lab</a></div>
<button class="round" type="button" aria-label="Search">{SEARCH}</button>
</nav>
<div class="me"><span class="synth">Synthetic data</span><button type="button" aria-label="Account menu, Shreya" style="border:0;background:none;padding:0;display:flex"><span class="av g lg">S</span></button></div>
</header>'''


def delta(size=16):
    return f'<svg width="{size}" height="{round(size*0.9)}" viewBox="0 0 16 14" role="img" aria-label="Differs from SOP" style="flex:none;overflow:visible"><path class="delta" d="M8 1 15 13H1Z"/></svg>'


def ask(scope, placeholder):
    return f'''<div class="ask">
<div style="display:flex;align-items:center;justify-content:space-between;gap:12px"><label class="h3" for="ask">Ask</label><span class="scope">{scope}<button type="button" aria-label="Clear scope">×</button></span></div>
<div class="ask-row"><textarea id="ask" placeholder="{placeholder}"></textarea><button class="send" type="button" aria-label="Send">{SEND}</button></div>
</div>'''


def fig(m):
    name, _, w = m.group(1).partition("@")
    svg = FIGS[name]
    if w:
        vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', svg)
        h = round(float(w) * float(vb.group(2)) / float(vb.group(1)))
        svg = re.sub(r'^<svg([^>]*?) width="[\d.]+" height="[\d.]+"', rf'<svg\1 width="{w}" height="{h}"', svg, count=1)
    return svg


def build(src):
    s = src.read_text()
    s = s.replace("<!--CSS-->", CSS)
    s = re.sub(r"<!--TOPBAR:(\w+)-->", lambda m: topbar(m.group(1)), s)
    s = re.sub(r"<!--DELTA(?::(\d+))?-->", lambda m: delta(int(m.group(1) or 16)), s)
    s = re.sub(r"<!--ASK:([^|]*)\|([^>]*)-->", lambda m: ask(m.group(1), m.group(2)), s)
    s = re.sub(r"<!--FIG:([\w@-]+)-->", fig, s)
    out = HERE / "project" / src.name
    out.parent.mkdir(exist_ok=True)
    out.write_text(s)
    print(out.name, len(s))


for name in sys.argv[1:] or [p.name for p in sorted((HERE / "src").glob("*.dc.html"))]:
    build(HERE / "src" / name)
