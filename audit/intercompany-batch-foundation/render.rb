# encoding: utf-8
# IC-1 foundation, the ruby writer: Ruby's CSV library with its defaults
# (quoting as needed, LF). Reads [{path, cells}] as JSON on stdin.
require 'csv'
require 'json'

JSON.parse($stdin.read).each do |file|
  File.open(file['path'], 'w:UTF-8') do |out|
    file['cells'].each { |row| out.write(CSV.generate_line(row, row_sep: "\n")) }
  end
end
