# FIN-1 H1 writer: Ruby's csv library with its defaults (LF line ends,
# quotes only where needed, and every empty string quoted as "").
# Reads [{"path":..., "cells":[[...]]}] on stdin.
require 'csv'
require 'json'

JSON.parse($stdin.read).each do |f|
  File.open(f['path'], 'wb') do |out|
    f['cells'].each { |row| out.write(CSV.generate_line(row)) }
  end
end
