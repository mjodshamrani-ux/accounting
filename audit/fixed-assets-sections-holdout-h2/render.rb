# Ruby 3.3 with its standard csv library 3.2.8: CRLF, quoted only when the
# library decides, an empty string written as "" (quote_empty, the default).
# Reads the rows as JSON from ARGV[0], writes ARGV[1].
require "csv"
require "json"
rows = JSON.parse(File.read(ARGV[0], encoding: "UTF-8"))
out = CSV.generate(row_sep: "\r\n") do |csv|
  rows.each { |r| csv << r }
end
File.binwrite(ARGV[1], out.b)
