# mawk 1.3.4, bytes as they come (LC_ALL=C): a byte-order mark first, LF, a
# field quoted only when it holds a comma, a quote, CR or LF. Records arrive
# separated by U+001E and fields by U+001F, which the contract forbids in a
# cell, so none is lost.
BEGIN { RS = "\036"; FS = "\037"; ORS = "\n"; printf "%s", "\357\273\277" }
{
  line = ""
  for (i = 1; i <= NF; i++) {
    v = $i
    if (v ~ /[,"\r\n]/) { gsub(/"/, "\"\"", v); v = "\"" v "\"" }
    line = line (i > 1 ? "," : "") v
  }
  print line
}
