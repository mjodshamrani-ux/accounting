# The C4 company ledgers written by caxlsx, as a Rails back office exports a
# bank ledger.
#
#   BUNDLE_GEMFILE=ruby/Gemfile bundle exec ruby ruby/ledgers.rb <ledgers.json>
#
# Writes every ledger whose writer is 'caxlsx', one sheet named as the spec
# says, row by row: a text cell as a string, {"n": text} as an Integer or a
# Float as its text reads, {"d": iso} as a Date, each styled with its
# "fmt" when it has one, and an empty cell as nothing. Every type is given,
# so caxlsx never guesses one from a value. The package's creation date is
# fixed, so the bytes do not depend on the clock.
require 'date'
require 'json'
require 'caxlsx'

STAMP = Time.utc(2029, 8, 1, 12, 0, 0)

JSON.parse(File.read(ARGV.fetch(0), encoding: 'UTF-8'))['ledgers'].each do |ledger|
  next unless ledger['writer'] == 'caxlsx'

  package = Axlsx::Package.new(author: 'C4 ledger export')
  package.core.created = STAMP
  workbook = package.workbook
  styles = Hash.new { |h, code| h[code] = workbook.styles.add_style(format_code: code) }
  workbook.add_worksheet(name: ledger['sheet']) do |sheet|
    ledger['rows'].each do |row|
      values, types, style = [], [], []
      row.each do |cell|
        if cell.is_a?(Hash) && cell.key?('n')
          integral = cell['n'].match?(/\A-?\d+\z/)
          values << (integral ? Integer(cell['n'], 10) : Float(cell['n']))
          types << (integral ? :integer : :float)
        elsif cell.is_a?(Hash) && cell.key?('d')
          values << Date.iso8601(cell['d'])
          types << :date
        else
          values << (cell == '' ? nil : cell)
          types << :string
        end
        style << (cell.is_a?(Hash) && cell['fmt'] ? styles[cell['fmt']] : nil)
      end
      sheet.add_row values, types: types, style: style
    end
  end
  package.serialize(ledger['out'])
end
