# The G23 typed XLSX cashbook, written by write_xlsx as a Ruby back office
# exports a ledger: the CSV's headers on the first row, then one entry per
# row, the date as an Excel date shown yyyy-mm-dd, each amount as a number
# in riyals shown #,##0.00, the other amount cell left empty. write_xlsx
# writes its strings to a shared table and stamps docProps/core.xml with the
# creation time it is given, here a fixed one.
#
#   BUNDLE_GEMFILE=<ruby dir>/Gemfile bundle exec ruby ruby/cashbook.rb <cashbooks.json>
require 'json'
require 'write_xlsx'

STAMP = Time.utc(2030, 1, 31, 12, 0, 0)

JSON.parse(File.read(ARGV[0]))['cashbooks'].each do |book|
  next unless book['kind'] == 'typed'
  workbook = WriteXLSX.new(book['out'])
  workbook.set_properties(title: 'Cashbook', created: STAMP)
  sheet = workbook.add_worksheet('Cashbook')
  dates = workbook.add_format(num_format: 'yyyy-mm-dd')
  money = workbook.add_format(num_format: '#,##0.00')
  sheet.write_row(0, 0, book['headers'])
  book['entries'].each_with_index do |e, i|
    row = i + 1
    sheet.write_date_time(row, 0, "#{e['date']}T", dates)
    sheet.write_string(row, 1, e['voucher'])
    sheet.write_string(row, 2, e['description'])
    sheet.write_string(row, 3, e['reference']) unless e['reference'].empty?
    [e['receipt'], e['payment']].each_with_index do |minor, k|
      sheet.write_number(row, 4 + k, minor / 100.0, money) if minor.positive?
    end
  end
  workbook.close
end
