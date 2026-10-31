// FA-1 H1 (copied from the PG-1 H1 writers), the Java writer: a field is quoted only when it holds a comma,
// a quote or a line break, quotes doubled, CRLF after every row. Reads lines
// of tab-separated, backslash-escaped cells framed by render.py on stdin.
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class Render {
    static String unescape(String s) {
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '\\' && i + 1 < s.length()) {
                char n = s.charAt(++i);
                b.append(n == 'n' ? '\n' : n == 'r' ? '\r' : n == 't' ? '\t' : n);
            } else b.append(c);
        }
        return b.toString();
    }
    static String field(String v) {
        if (v.indexOf(',') < 0 && v.indexOf('"') < 0 && v.indexOf('\n') < 0 && v.indexOf('\r') < 0) return v;
        return "\"" + v.replace("\"", "\"\"") + "\"";
    }
    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        Writer out = null;
        String line;
        while ((line = in.readLine()) != null) {
            if (line.startsWith("FILE\t")) {
                if (out != null) out.close();
                out = new OutputStreamWriter(new FileOutputStream(unescape(line.substring(5))), StandardCharsets.UTF_8);
            } else if (line.equals("ROW")) {
                out.write("\r\n");
            } else if (line.startsWith("ROW\t")) {
                String[] cells = line.substring(4).split("\t", -1);
                StringBuilder b = new StringBuilder();
                for (int i = 0; i < cells.length; i++) {
                    if (i > 0) b.append(',');
                    b.append(field(unescape(cells[i])));
                }
                out.write(b.append("\r\n").toString());
            }
        }
        if (out != null) out.close();
    }
}
