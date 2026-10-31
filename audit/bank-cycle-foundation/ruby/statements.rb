# The G23 statement service: a Ruby program drawing statements with HexaPDF.
#
#   BUNDLE_GEMFILE=<ruby dir>/Gemfile bundle exec ruby ruby/statements.rb <statements.json>
#
# HexaPDF is a pure Ruby library that reads and writes PDF; it embeds a
# TrueType font as a Type0 font, subset, with a ToUnicode map, and draws
# text glyph by glyph as its font gives them, without shaping, so the
# service writes English statements only. It lays out its own table on the
# page canvas, as the Node application of G23 does:
# - columns from the left; a heading row filled, grey or ruled, its headings
#   at the start of their cells, or, where the style says so, at the left
#   over right-aligned amounts;
# - rules as a grid, under each row, as stripes or none; descriptions
#   wrapped by word to their cell; control lines with their label across the
#   first four columns; the footer as the facts number the page.
# Each piece of text is one text object at its baseline: the line's top plus
# the font's ascent, which the job gives from the font's hhea table.
# HexaPDF's defaults are kept: on writing it sets its own Producer, the
# modification date and a new document identifier from the clock and chance,
# and its subsetter stamps each subset font's head table with the clock; the
# creation date is fixed here. So two renders differ in those bytes alone.
require 'json'
require 'hexapdf'

STAMP = Time.utc(2030, 1, 31, 12, 0, 0)
PAPER = { 'A4' => [595.28, 841.89], 'Letter' => [612.0, 792.0], 'A4-landscape' => [841.89, 595.28] }.freeze
WIDTHS = [0.095, 0.095, 0.31, 0.17, 0.11, 0.11, 0.11].freeze
STRIPE = [241, 242, 244].freeze
RULE = [89, 89, 89].freeze

def rgb(hex)
  [hex[0, 2], hex[2, 2], hex[4, 2]].map { |p| p.to_i(16) }
end

# One statement, page by page.
class Statement
  def initialize(job, doc)
    @job = job
    @doc = doc
    @fonts = { '400' => doc.fonts.add(job['regular']), '700' => doc.fonts.add(job['bold']) }
    @size = job['size']
  end

  def width(text, weight, size)
    @fonts[weight].decode_utf8(text).sum(&:width) * size / 1000.0
  end

  # One line of text whose top is `top` from the page top, in a box from x of
  # `width`, at its start (left) or end (right) edge; text wider than its box
  # is refused, not drawn over the next cell.
  def line(text, x, top, weight: '400', size: @size, width: nil, align: 'start', ink: [0, 0, 0])
    return if text.empty?
    drawn = width(text, weight, size)
    raise "#{@job['id']}: #{text.inspect} is wider than its cell" if width && drawn > width + 0.001
    pen = x
    pen = x + width - drawn if width && align == 'end'
    baseline = @height - top - @job['ascent'] * size
    @canvas.fill_color(*ink)
    @canvas.font(@fonts[weight], size: size)
    @canvas.text(text, at: [pen, baseline])
  end

  def wrap(text, width)
    lines = []
    line = []
    text.split(/\s+/).reject(&:empty?).each do |word|
      candidate = (line + [word]).join(' ')
      if !line.empty? && width(candidate, '400', @size) > width
        lines << line.join(' ')
        line = [word]
      else
        line << word
      end
    end
    lines << line.join(' ') unless line.empty?
    lines.empty? ? [''] : lines
  end

  def columns(left, right)
    total = right - left
    x = left
    WIDTHS.map do |w|
      c = [x, w * total]
      x += w * total
      c
    end
  end

  def amounts(k)
    k < 4 ? 'start' : 'end'
  end

  def heading_align(k)
    @job['style']['headings'] == 'left' ? 'start' : amounts(k)
  end

  def rule(x0, y0, x1, y1, thickness = 0.5, ink = RULE)
    @canvas.save_graphics_state do
      @canvas.line_width(thickness)
      @canvas.stroke_color(*ink)
      @canvas.line(x0, @height - y0, x1, @height - y1).stroke
    end
  end

  def fill(x, y, w, h, ink)
    @canvas.save_graphics_state do
      @canvas.fill_color(*ink)
      @canvas.rectangle(x, @height - y - h, w, h).fill
    end
  end

  def page(page)
    job = @job
    style = job['style']
    width, @height = PAPER[job['paper']]
    @canvas = @doc.pages.add([0, 0, width, @height]).canvas
    margin = 34
    left = margin
    right = width - margin
    y = margin
    line(job['bank'], left, y, weight: '700', size: 13.5, width: right - left)
    y += 19
    line(job['title'], left, y, size: 10.5, width: right - left)
    y += 16
    line(job['account'], left, y, size: 8.2, width: right - left)
    y += 16
    cols = columns(left, right)
    pad = 3.2
    lh = job['lineHeight'] * @size
    rules = style['rules'] || 'grid'
    heading = style['heading'] || 'rule'
    head_h = lh + 2 * pad + 1
    fill(left, y, right - left, head_h, rgb(job['fill'])) if heading == 'filled'
    fill(left, y, right - left, head_h, [220, 220, 220]) if heading == 'grey'
    ink = heading == 'filled' ? [255, 255, 255] : [0, 0, 0]
    cols.each_with_index do |(x, w), k|
      line(job['headers'][k], x + pad, y + pad, weight: '700', width: w - 2 * pad, align: heading_align(k), ink: ink)
    end
    top = y
    y += head_h
    rule(left, y, right, y, 0.8, [0, 0, 0]) if heading == 'rule' || rules == 'rows' || rules == 'none'
    bounds = []
    page['rows'].each_with_index do |row, n|
      kind = row['kind']
      cells = row['cells']
      row_top = y
      if kind == 'movement' || kind == 'continuation'
        text = kind == 'movement' ? cells[2] : cells[0]
        wrapped = wrap(text, cols[2][1] - 2 * pad)
        h = wrapped.length * lh + 2 * pad
        fill(left, y, right - left, h, STRIPE) if rules == 'stripes' && n.odd?
        wrapped.each_with_index { |part, i| line(part, cols[2][0] + pad, y + pad + i * lh) }
        if kind == 'movement'
          cols.each_with_index do |(x, w), k|
            line(cells[k], x + pad, y + pad, width: w - 2 * pad, align: amounts(k)) unless k == 2
          end
        end
      else
        h = lh + 2 * pad
        fill(left, y, right - left, h, STRIPE) if rules == 'stripes' && n.odd?
        line(cells[0], cols[0][0] + pad, y + pad, weight: '700')
        values = kind == 'label' ? [[6, cells[1]]] : [[4, cells[1]], [5, cells[2]]]
        values.each do |k, value|
          x, w = cols[k]
          line(value, x + pad, y + pad, weight: '700', width: w - 2 * pad, align: amounts(k))
        end
      end
      y += h
      bounds << [row_top, y, kind == 'label' || kind == 'totals']
      rule(left, y, right, y, 0.4) if rules == 'rows'
    end
    if rules == 'grid'
      # Each row's own column edges: a control line's label spans the first
      # four columns, so no edge is drawn through it.
      ([top, top + head_h] + bounds.map { |b| b[1] }).each { |edge| rule(left, edge, right, edge) }
      every = cols.flat_map { |x, w| [(x * 100).round / 100.0, ((x + w) * 100).round / 100.0] }.uniq.sort
      inside = [1, 2, 3].map { |k| (cols[k][0] * 100).round / 100.0 }
      every.each { |x| rule(x, top, x, top + head_h) }
      bounds.each do |row_top, row_bottom, spanned|
        every.each { |x| rule(x, row_top, x, row_bottom) unless spanned && inside.include?(x) }
      end
    end
    raise "#{job['id']} page #{page['footer']}: the table runs off the page" if y > @height - margin - 20
    line(page['footer'], left, @height - margin - 8, size: 8, width: right - left, align: 'end')
  end

  def write
    @job['pages'].each { |p| page(p) }
    info = @doc.trailer.info
    info[:Title] = "#{@job['title']} #{@job['number']}"
    info[:Author] = @job['bank']
    info[:Creator] = 'G23 statement service (HexaPDF)'
    info[:CreationDate] = STAMP
    @doc.write(@job['out'])
  end
end

JSON.parse(File.read(ARGV[0]))['statements'].each do |job|
  Statement.new(job, HexaPDF::Document.new).write
end
