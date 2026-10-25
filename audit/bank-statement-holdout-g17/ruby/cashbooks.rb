# The G17 typed XLSX cashbooks, written by caxlsx as a Rails export would.
#
#   BUNDLE_GEMFILE=ruby/Gemfile bundle exec ruby ruby/cashbooks.rb <cashbooks.json>
#
# Writes every cashbook whose kind is 'typed': the six headings as text, the
# date as a Date styled yyyy-mm-dd, voucher, description and reference as
# text, and each amount as a Float in riyals styled #,##0.00, the other
# amount cell left empty. The package's creation date is fixed, so the bytes
# do not depend on the clock.
require 'date'
require 'json'
require 'caxlsx'

STAMP = Time.utc(2028, 1, 31, 12, 0, 0)

JSON.parse(File.read(ARGV.fetch(0), encoding: 'UTF-8'))['cashbooks'].each do |book|
  next unless book['kind'] == 'typed'

  package = Axlsx::Package.new(author: 'G17 cashbook export')
  package.core.created = STAMP
  workbook = package.workbook
  date = workbook.styles.add_style(format_code: 'yyyy-mm-dd')
  money = workbook.styles.add_style(format_code: '#,##0.00')
  workbook.add_worksheet(name: 'Cashbook') do |sheet|
    sheet.add_row book['headers'], types: [:string] * 6
    book['entries'].each do |e|
      amount = ->(minor) { minor.positive? ? minor / 100.0 : nil }
      sheet.add_row [Date.iso8601(e['date']), e['voucher'], e['description'], e['reference'],
                     amount.call(e['receipt']), amount.call(e['payment'])],
                    types: %i[date string string string float float],
                    style: [date, nil, nil, nil, money, money]
    end
  end
  package.serialize(book['out'])
end
