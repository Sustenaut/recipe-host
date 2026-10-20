// Printable recipe card: one A5 sheet (148 x 210 mm), which folds out of
// A4 and fits a standard A5 binder or card box. `recipe-host build` writes
// each recipe's card data as JSON and compiles this file once per recipe:
//
//   typst compile --input data=/card.json recipe-card.typ out.pdf
//
// The JSON holds plain text only (see cardData in lib/build.js), so this
// file never parses Markdown.

#let data = json(sys.inputs.data)

#let accent = rgb(0x8a, 0x3b, 0x12)   // warm brown, for the title and rules
#let muted = rgb(0x55, 0x55, 0x55)

#set document(title: data.title)
#set page(
  paper: "a5",
  margin: (x: 12mm, top: 12mm, bottom: 14mm),
  footer: context {
    set text(size: 7pt, fill: muted)
    if data.footer != none [#data.footer]
    h(1fr)
    let total = counter(page).final().first()
    if total > 1 [#counter(page).display() / #total]
  },
)
#set text(font: ("Libertinus Serif", "DejaVu Serif"), size: 9.5pt, fill: rgb(0x22, 0x22, 0x22))
#set par(justify: false, leading: 0.55em, spacing: 0.8em)
#set enum(spacing: 0.6em, indent: 0.2em)
#show link: set text(fill: accent)

#let heading-text(body) = {
  set text(size: 10.5pt, weight: "bold", fill: accent)
  v(0.5em)
  block(below: 0.45em, upper(body))
}

// Long ingredient lists go in two columns so a typical recipe still fits
// on one side. Typst's columns() never balances, so the items are split in
// half by hand.
#let bullets(items) = {
  let column(part) = stack(
    spacing: 0.45em,
    ..part.map(item => grid(columns: (0.9em, 1fr), [•], item)),
  )
  if items.len() <= 6 {
    column(items)
  } else {
    let half = calc.ceil(items.len() / 2)
    grid(
      columns: (1fr, 1fr),
      column-gutter: 5mm,
      column(items.slice(0, half)),
      column(items.slice(half)),
    )
  }
}

#text(size: 17pt, weight: "bold", fill: accent, data.title)
#if data.subtitle != none {
  linebreak()
  text(size: 10pt, style: "italic", fill: muted, data.subtitle)
}
#line(length: 100%, stroke: 0.6pt + accent)

#if data.facts.len() > 0 or data.source != none {
  let parts = data.facts.map(f => [*#f.label* #f.value])
  if data.source != none {
    parts.push([Adapted from #link(data.source.url, data.source.host)])
  }
  par(parts.join([ · ]))
}

#for block in data.intro {
  if block.kind == "note" {
    rect(width: 100%, stroke: (left: 1.5pt + accent), inset: (left: 6pt, y: 3pt))[
      #set text(size: 8.5pt, style: "italic")
      #block.text
    ]
  } else {
    par(block.text)
  }
}

#heading-text[Ingredients]
#for group in data.groups {
  if group.title != none {
    text(weight: "bold", group.title)
    v(0.2em)
  }
  bullets(group.items)
  v(0.3em)
}

#heading-text[Method]
#enum(..data.steps.map(step => {
  if step.name != none [*#step.name.* #step.text] else [#step.text]
}))

#if data.notes.len() > 0 {
  heading-text[Notes]
  bullets(data.notes)
}
