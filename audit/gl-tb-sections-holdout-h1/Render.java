// GLT-1 holdout H1, the Java writer, written by hand: a field is quoted when it
// holds a comma, a quote, a line break or a leading or trailing space; CRLF
// after every row. Reads [{path, cells}] as JSON on stdin with a small parser
// for that shape alone.
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

public class Render {
    private final String s;
    private int i;

    Render(String s) { this.s = s; }

    private void skip() { while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++; }

    private void expect(char c) {
        skip();
        if (s.charAt(i++) != c) throw new IllegalStateException("expected " + c + " at " + (i - 1));
    }

    private String string() {
        expect('"');
        StringBuilder b = new StringBuilder();
        while (true) {
            char c = s.charAt(i++);
            if (c == '"') return b.toString();
            if (c != '\\') { b.append(c); continue; }
            char e = s.charAt(i++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 'r': b.append('\r'); break;
                case 't': b.append('\t'); break;
                case 'u': b.append((char) Integer.parseInt(s.substring(i, i + 4), 16)); i += 4; break;
                default: b.append(e);
            }
        }
    }

    private <T> List<T> list(java.util.function.Supplier<T> item) {
        List<T> out = new ArrayList<>();
        expect('[');
        skip();
        if (s.charAt(i) == ']') { i++; return out; }
        while (true) {
            out.add(item.get());
            skip();
            char c = s.charAt(i++);
            if (c == ']') return out;
            if (c != ',') throw new IllegalStateException("expected , at " + (i - 1));
        }
    }

    private static String field(String v) {
        boolean quote = v.contains(",") || v.contains("\"") || v.contains("\n") || v.contains("\r")
            || (!v.isEmpty() && (v.charAt(0) == ' ' || v.charAt(v.length() - 1) == ' '));
        return quote ? "\"" + v.replace("\"", "\"\"") + "\"" : v;
    }

    public static void main(String[] args) throws IOException {
        Render r = new Render(new String(System.in.readAllBytes(), StandardCharsets.UTF_8));
        r.list(() -> {
            r.expect('{');
            String path = null;
            List<List<String>> cells = null;
            for (int k = 0; k < 2; k++) {
                String key = r.string();
                r.expect(':');
                if (key.equals("path")) path = r.string();
                else cells = r.list(() -> r.list(r::string));
                r.skip();
                if (r.s.charAt(r.i) == ',') r.i++;
            }
            r.expect('}');
            StringBuilder out = new StringBuilder();
            for (List<String> row : cells) {
                List<String> quoted = new ArrayList<>();
                for (String v : row) quoted.add(field(v));
                out.append(String.join(",", quoted)).append("\r\n");
            }
            try {
                Files.writeString(Path.of(path), out.toString(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new RuntimeException(e);
            }
            return path;
        });
    }
}
