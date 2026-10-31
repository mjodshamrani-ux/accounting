// G8 holdout statement in Typst. Every printed string comes from data.json,
// written by render_typst.py from the facts; this file only lays it out:
// one Typst page per statement page, the furniture on top, one table, and
// the `Page n of N` footer. Typst shapes Arabic and lays the table out right
// to left by itself when the text direction is right to left.
#let d = json("data.json")
#let s = d.style
#let reading = if d.dir == "rtl" { rtl } else { ltr }
#set document(title: d.title, author: d.bank, date: none)
#set text(font: d.fonts, size: d.size * 1pt, lang: d.lang, dir: reading, hyphenate: false)
#set par(justify: false, leading: 0.45em)

#let lines(t) = t.split("\n").join(linebreak())
#let heading-cell(i, h) = {
  let body = if i == 1 and s.at("valueDateHeading", default: "") == "two-lines" {
    h.split(" ").join(linebreak())
  } else { h }
  let body = if s.heading == "band" { text(fill: white, weight: "bold", body) } else { body }
  let a = if i >= 4 and s.at("amountHeadingAlign", default: "") == "end" { end } else if s.headingAlign == "center" { center } else { start }
  table.cell(align: a + top, body)
}
#let fill = (x, y) => {
  if y == 0 and s.heading == "band" { rgb("#1f3a5f") }
  else if y == 0 and s.heading == "band-light" { rgb("#dde3ea") }
  else if y > 0 and s.at("stripes", default: false) and calc.even(y) { rgb("#eef2f7") }
}
#let stroke = if s.rules == "grid" { 0.4pt + rgb("#555555") } else if s.rules == "heading" {
  (x, y) => if y == 0 { (bottom: 0.6pt) }
} else { none }

#for p in d.pages {
  page(
    paper: d.paper,
    flipped: d.landscape,
    margin: (x: 1.5cm, top: 1.4cm, bottom: 1.8cm),
    footer: align(center, text(size: 8pt, p.footer)),
  )[
    #text(size: 13pt, d.bank) \
    #text(size: 10.5pt, d.documentTitle) \
    #text(size: d.size * 1pt, d.accountLine)
    #v(6pt)
    #table(
      columns: (auto, auto, 1fr, auto, auto, auto, auto),
      inset: (x: 4pt, y: 3pt),
      fill: fill,
      stroke: stroke,
      align: (x, y) => if x >= 4 { end + top } else { start + top },
      table.header(..d.headings.enumerate().map(((i, h)) => heading-cell(i, h))),
      ..p.rows.map(r => {
        if r.kind == "label" {
          (table.cell(colspan: 6, r.cells.at(0)), r.cells.at(1))
        } else if r.kind == "totals" {
          (table.cell(colspan: 4, r.cells.at(0)), r.cells.at(1), r.cells.at(2), [])
        } else if r.kind == "continuation" {
          ([], [], lines(r.cells.at(0)), [], [], [], [])
        } else {
          r.cells.enumerate().map(((i, c)) => if i == 2 { lines(c) } else { c })
        }
      }).flatten(),
    )
  ]
}
