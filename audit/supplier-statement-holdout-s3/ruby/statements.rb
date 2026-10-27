# The S3 statement service: a Ruby program drawing supplier statements with HexaPDF.
#
#   BUNDLE_GEMFILE=<ruby dir>/Gemfile bundle exec ruby ruby/statements.rb <statements.json>
#
# HexaPDF is a pure Ruby library that reads and writes PDF; it embeds a
# TrueType font as a Type0 font, subset, with a ToUnicode map, and draws
# text glyph by glyph as its font gives them, without shaping, so the
# service writes English statements only. It lays out its own table on the
# page canvas from the job's columns:
# - columns from the left at the job's shares; a heading row filled, grey or
#   ruled, headings at the start of text cells and the end of amount cells;
# - rules as a grid, under each row, as stripes or none; descriptions
#   wrapped by word to their cell; control lines with their label across the
#   text columns before the first amount column; the footer as the facts
#   number the page.
# Each piece of text is one text object at its baseline: the line's top plus
# the font's ascent, which the job gives from the font's hhea table.
# HexaPDF's defaults are kept: on writing it sets its own Producer, the
# modification date and a new document identifier from the clock and chance,
# and its subsetter stamps each subset font with the clock; the creation date
# is fixed here. So two renders differ in those bytes alone.
require 'json'
require 'hexapdf'

STAMP = Time.utc(2030, 1, 31, 12, 0, 0)
PAPER = { 'A4' => [595.28, 841.89], 'Letter' => [612.0, 792.0], 'A4-landscape' => [841.89, 595.28] }.freeze
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
    @job['columns'].map do |c|
      box = [x, c['share'] * total]
      x += c['share'] * total
      box
    end
  end

  def align(k)
    @job['columns'][k]['amount'] ? 'end' : 'start'
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
    line(job['preamble'][0], left, y, weight: '700', size: 13.5, width: right - left)
    y += 19
    line(job['preamble'][1], left, y, size: 10.5, width: right - left)
    y += 16
    line(job['preamble'][2], left, y, size: 8.2, width: right - left)
    y += 16
    cols = columns(left, right)
    desc = job['columns'].index { |c| c['key'] == 'desc' }
    first_amount = job['columns'].index { |c| c['amount'] }
    pad = 3.2
    lh = job['lineHeight'] * @size
    rules = style['rules'] || 'grid'
    heading = style['heading'] || 'rule'
    head_h = lh + 2 * pad + 1
    fill(left, y, right - left, head_h, rgb(job['fill'])) if heading == 'filled'
    fill(left, y, right - left, head_h, [220, 220, 220]) if heading == 'grey'
    ink = heading == 'filled' ? [255, 255, 255] : [0, 0, 0]
    cols.each_with_index do |(x, w), k|
      line(job['columns'][k]['heading'], x + pad, y + pad, weight: '700', width: w - 2 * pad, align: align(k), ink: ink)
    end
    top = y
    y += head_h
    rule(left, y, right, y, 0.8, [0, 0, 0]) if heading == 'rule' || rules == 'rows' || rules == 'none'
    bounds = []
    page['rows'].each_with_index do |row, n|
      row_top = y
      if row['kind'] == 'movement'
        wrapped = wrap(row['cells'][desc], cols[desc][1] - 2 * pad)
        h = wrapped.length * lh + 2 * pad
        fill(left, y, right - left, h, STRIPE) if rules == 'stripes' && n.odd?
        wrapped.each_with_index do |part, i|
          line(part, cols[desc][0] + pad, y + pad + i * lh, width: cols[desc][1] - 2 * pad)
        end
        cols.each_with_index do |(x, w), k|
          line(row['cells'][k], x + pad, y + pad, width: w - 2 * pad, align: align(k)) unless k == desc
        end
      else
        h = lh + 2 * pad
        fill(left, y, right - left, h, STRIPE) if rules == 'stripes' && n.odd?
        span_w = cols[0, first_amount].sum { |_, w| w }
        line(row['label'], cols[0][0] + pad, y + pad, weight: '700', width: span_w - 2 * pad)
        row['values'].each do |k, value|
          x, w = cols[k.to_i]
          line(value, x + pad, y + pad, weight: '700', width: w - 2 * pad, align: align(k.to_i))
        end
      end
      y += h
      bounds << [row_top, y, row['kind'] == 'control']
      rule(left, y, right, y, 0.4) if rules == 'rows'
    end
    if rules == 'grid'
      # Each row's own column edges: a control line's label spans the text
      # columns, so no edge is drawn through it.
      ([top, top + head_h] + bounds.map { |b| b[1] }).each { |edge| rule(left, edge, right, edge) }
      every = cols.flat_map { |x, w| [(x * 100).round / 100.0, ((x + w) * 100).round / 100.0] }.uniq.sort
      inside = (1...first_amount).map { |k| (cols[k][0] * 100).round / 100.0 }
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
    info[:Title] = "#{@job['preamble'][1]} #{@job['account']}"
    info[:Author] = @job['preamble'][0]
    info[:Creator] = 'S3 statement service (HexaPDF)'
    info[:CreationDate] = STAMP
    @doc.write(@job['out'])
  end
end

JSON.parse(File.read(ARGV[0]))['statements'].each do |job|
  Statement.new(job, HexaPDF::Document.new).write
end
