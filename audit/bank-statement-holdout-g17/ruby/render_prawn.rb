# The G17 Prawn statements: a Rails-style statement job drawing with Prawn.
#
#   BUNDLE_GEMFILE=ruby/Gemfile bundle exec ruby ruby/render_prawn.rb <statements.json>
#
# Each page of the facts is one prawn-table table under the bank's heading,
# its footer as the facts number the page; a page that would not fit is an
# error, not a page break. The family is registered from its Latin TrueType
# files and Prawn subsets and embeds it. The document dates are fixed, so the
# bytes do not depend on the clock.
require 'json'
require 'prawn'
require 'prawn/table'

STAMP = Time.utc(2028, 1, 31, 12, 0, 0)
PAPER = { 'A4' => ['A4', :portrait], 'Letter' => ['LETTER', :portrait], 'A4-landscape' => ['A4', :landscape] }.freeze
WIDTHS = [0.1, 0.1, 0.31, 0.16, 0.11, 0.11, 0.11].freeze
STRIPE = 'F0F2F4'

def statement(job)
  size, layout = PAPER.fetch(job['paper'])
  style = job['style']
  pdf = Prawn::Document.new(page_size: size, page_layout: layout, margin: 34,
                            info: { Title: "#{job['title']} #{job['number']}", Author: job['bank'],
                                    Creator: 'G17 statement job (Prawn)', Producer: "Prawn #{Prawn::VERSION}",
                                    CreationDate: STAMP, ModDate: STAMP })
  pdf.font_families.update(job['family'] => { normal: job['regular'], bold: job['bold'] })
  pdf.font(job['family'])
  body = job['family'] == 'Ubuntu Mono' ? 7.4 : 7.2
  body = 7.6 if job['paper'] == 'A4-landscape'
  widths = WIDTHS.map { |w| w * pdf.bounds.width }
  job['pages'].each_with_index do |page, index|
    pdf.start_new_page if index.positive?
    pdf.text job['bank'], size: 13.5, style: :bold
    pdf.move_down 2
    pdf.text job['title'], size: 10.5
    pdf.move_down 2
    pdf.text job['account'], size: 8.2
    pdf.move_down 8
    rows = [job['headers'].each_with_index.map do |h, k|
      align = k >= 4 && style['headings'] != 'left' ? :right : :left
      { content: h, font_style: :bold, align: align }
    end]
    page['rows'].each do |row|
      cells = row['cells']
      case row['kind']
      when 'movement'
        rows << cells.each_with_index.map { |c, k| { content: c, align: k >= 4 ? :right : :left } }
      when 'label'
        rows << [{ content: cells[0], colspan: 4, font_style: :bold }, '', '', { content: cells[1], align: :right, font_style: :bold }]
      when 'totals'
        rows << [{ content: cells[0], colspan: 4, font_style: :bold }, { content: cells[1], align: :right, font_style: :bold },
                 { content: cells[2], align: :right, font_style: :bold }, '']
      when 'continuation'
        rows << ['', '', cells[0], '', '', '', '']
      end
    end
    rules = style['rules']
    heading = style['heading']
    start_page = pdf.page_number
    pdf.table(rows, column_widths: widths, header: false,
                    cell_style: { size: body, padding: [3, 3.5, 3, 3.5], border_width: 0.5, border_color: '595959',
                                  borders: rules == 'grid' ? %i[top bottom left right] : [] }) do |t|
      t.row(0).font_style = :bold
      if heading == 'filled'
        t.row(0).background_color = job['fill']
        t.row(0).text_color = 'FFFFFF'
      end
      if heading == 'rule' || %w[rows none].include?(rules)
        t.row(0).borders = rules == 'grid' ? %i[top bottom left right] : [:bottom]
        t.row(0).border_bottom_width = 0.8
        t.row(0).border_bottom_color = '000000'
      end
      if rules == 'rows'
        (1...rows.length).each { |r| t.row(r).borders = [:bottom]; t.row(r).border_bottom_width = 0.4 }
      end
      if rules == 'stripes'
        (1...rows.length).each { |r| t.row(r).background_color = STRIPE if r.even? }
      end
    end
    raise "#{job['id']} page #{index + 1}: the table runs onto another page" if pdf.page_number != start_page

    pdf.bounding_box([0, 10], width: pdf.bounds.width, height: 12) do
      pdf.text page['footer'], size: 8, align: :right
    end
  end
  pdf.render_file(job['out'])
end

JSON.parse(File.read(ARGV.fetch(0), encoding: 'UTF-8'))['statements'].each { |job| statement(job) }
