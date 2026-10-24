import com.ibm.icu.text.ArabicShaping;
import com.ibm.icu.text.Bidi;
import com.ibm.icu.text.BidiRun;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import javax.xml.parsers.DocumentBuilderFactory;
import org.apache.pdfbox.cos.COSArray;
import org.apache.pdfbox.cos.COSString;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentInformation;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType0Font;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.apache.pdfbox.pdmodel.font.Standard14Fonts;
import org.apache.pdfbox.util.Version;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * G12 statements drawn with Apache PDFBox the way an application lays out its own table: each
 * page's letterhead, a table of rows and cells and a footer, every cell line placed by the
 * program and written with one showText. Arabic is shaped into presentation forms and put in
 * visual order by ICU4J before it is written, as PDFBox does neither. Where the statement's
 * style says so, each line is written run by run as the bidi algorithm divides it, each run of
 * one direction its own showText at its place, as an application that lays out bidi text itself
 * does; an overdrawn balance's DR is written in its own slot after the amount; and each cell's
 * text is clipped to its cell by a path traced back to its start. A cell line wider
 * than its cell is an error, so no clip hides a glyph. PDFBox would draw the file identifier from
 * the clock; it is drawn here from the statement's id, so the same facts give the same bytes.
 *
 * <p>Usage: java PdfBoxStatements statements.xml
 */
public class PdfBoxStatements {
  static final float MARGIN = 36f;

  static String attr(Element e, String name) {
    return e.getAttribute(name);
  }

  static List<Element> children(Element e, String name) {
    List<Element> out = new ArrayList<>();
    NodeList nodes = e.getChildNodes();
    for (int i = 0; i < nodes.getLength(); i++) {
      Node n = nodes.item(i);
      if (n instanceof Element && ((Element) n).getTagName().equals(name)) out.add((Element) n);
    }
    return out;
  }

  static PDRectangle paper(String name) {
    switch (name) {
      case "Letter": return PDRectangle.LETTER;
      case "Legal": return PDRectangle.LEGAL;
      // Landscape by its own width and height, not by turning the page.
      case "A4-landscape": return new PDRectangle(PDRectangle.A4.getHeight(), PDRectangle.A4.getWidth());
      default: return PDRectangle.A4;
    }
  }

  static PDFont font(PDDocument doc, String spec) throws Exception {
    if (spec.equals("Times-Roman")) return new PDType1Font(Standard14Fonts.FontName.TIMES_ROMAN);
    if (spec.equals("Times-Bold")) return new PDType1Font(Standard14Fonts.FontName.TIMES_BOLD);
    if (spec.equals("Courier")) return new PDType1Font(Standard14Fonts.FontName.COURIER);
    if (spec.equals("Courier-Bold")) return new PDType1Font(Standard14Fonts.FontName.COURIER_BOLD);
    return PDType0Font.load(doc, new File(spec));
  }

  /** Visual order for one line: Arabic shaped, the line reordered by the bidi algorithm. */
  static String visual(String text, boolean rtl) throws Exception {
    boolean arabic = text.codePoints().anyMatch(c -> c >= 0x0600 && c <= 0x06FF);
    if (!rtl && !arabic) return text;
    String shaped = new ArabicShaping(ArabicShaping.LETTERS_SHAPE | ArabicShaping.LENGTH_GROW_SHRINK).shape(text);
    Bidi bidi = new Bidi(shaped, rtl ? Bidi.RTL : Bidi.LTR);
    return bidi.writeReordered(Bidi.DO_MIRRORING);
  }

  /** The same line as its runs, left to right, a right-to-left run reversed and mirrored. */
  static List<String> runs(String text, boolean rtl) throws Exception {
    List<String> out = new ArrayList<>();
    boolean arabic = text.codePoints().anyMatch(c -> c >= 0x0600 && c <= 0x06FF);
    if (!rtl && !arabic) {
      out.add(text);
      return out;
    }
    String shaped = new ArabicShaping(ArabicShaping.LETTERS_SHAPE | ArabicShaping.LENGTH_GROW_SHRINK).shape(text);
    Bidi bidi = new Bidi(shaped, rtl ? Bidi.RTL : Bidi.LTR);
    for (int i = 0; i < bidi.countRuns(); i++) {
      BidiRun run = bidi.getVisualRun(i);
      String part = shaped.substring(run.getStart(), run.getLimit());
      out.add(run.isOddRun() ? Bidi.writeReverse(part, Bidi.DO_MIRRORING) : part);
    }
    if (!String.join("", out).equals(visual(text, rtl))) throw new IllegalStateException("runs differ: " + text);
    return out;
  }

  static float width(PDFont f, float size, String s) throws Exception {
    return f.getStringWidth(s) / 1000 * size;
  }

  /** Logical lines of a cell, broken between words where the next word would not fit. */
  static List<String> wrap(String text, PDFont f, float size, float room, boolean rtl) throws Exception {
    List<String> lines = new ArrayList<>();
    for (String para : text.split("\n")) {
      String line = "";
      for (String word : para.split(" ")) {
        String next = line.isEmpty() ? word : line + " " + word;
        if (!line.isEmpty() && width(f, size, visual(next, rtl)) > room) {
          lines.add(line);
          line = word;
        } else {
          line = next;
        }
      }
      lines.add(line);
    }
    for (String line : lines) {
      if (width(f, size, visual(line, rtl)) > room) throw new IllegalStateException("wider than its cell: " + line);
    }
    return lines;
  }

  static void text(PDPageContentStream cs, PDFont f, float size, float x, float y, String s) throws Exception {
    cs.beginText();
    cs.setFont(f, size);
    cs.newLineAtOffset(x, y);
    cs.showText(s);
    cs.endText();
  }

  /** One line in visual order from x: whole, or run by run where the style says so. */
  static void line(PDPageContentStream cs, PDFont f, float size, float x, float y, String logical, boolean rtl,
      boolean byRun) throws Exception {
    if (!byRun) {
      text(cs, f, size, x, y, visual(logical, rtl));
      return;
    }
    for (String run : runs(logical, rtl)) {
      if (run.isEmpty()) continue;
      text(cs, f, size, x, y, run);
      x += width(f, size, run);
    }
  }

  public static void main(String[] args) throws Exception {
    Element root =
        DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(new File(args[0])).getDocumentElement();
    for (Element st : children(root, "statement")) draw(st);
  }

  static void draw(Element st) throws Exception {
    try (PDDocument doc = new PDDocument()) {
      PDFont regular = font(doc, attr(st, "font"));
      PDFont bold = font(doc, attr(st, "bold"));
      boolean rtl = attr(st, "rtl").equals("1");
      float size = Float.parseFloat(attr(st, "size"));
      float pad = Float.parseFloat(attr(st, "padding"));
      float leading = size * Float.parseFloat(attr(st, "leading"));
      String rules = attr(st, "rules"), heading = attr(st, "heading");
      boolean drSlot = attr(st, "drSlot").equals("1"), clipCells = attr(st, "clip").equals("1");
      boolean byRun = attr(st, "runs").equals("1");
      String[] w = attr(st, "widths").split(",");
      PDRectangle box = paper(attr(st, "paper"));
      float usable = box.getWidth() - 2 * MARGIN, total = 0;
      for (String s : w) total += Float.parseFloat(s);
      float[] widths = new float[w.length];
      for (int i = 0; i < w.length; i++) widths[i] = Float.parseFloat(w[i]) / total * usable;
      PDDocumentInformation info = doc.getDocumentInformation();
      info.setTitle(attr(st, "title"));
      info.setCreator("Tarasuf holdout G12");
      info.setProducer("Apache PDFBox " + Version.getVersion());
      byte[] id = MessageDigest.getInstance("MD5").digest(attr(st, "id").getBytes(StandardCharsets.UTF_8));
      COSArray ids = new COSArray();
      ids.add(new COSString(id));
      ids.add(new COSString(id));
      doc.getDocument().setDocumentID(ids);
      for (Element pageEl : children(st, "page")) {
        PDPage page = new PDPage(box);
        doc.addPage(page);
        try (PDPageContentStream cs = new PDPageContentStream(doc, page)) {
          float y = box.getHeight() - MARGIN;
          for (Element line : children(pageEl, "line")) {
            float s = Float.parseFloat(attr(line, "size"));
            PDFont f = s > size + 1 ? bold : regular;
            y -= s;
            float tw = width(f, s, visual(line.getTextContent(), rtl));
            line(cs, f, s, rtl ? box.getWidth() - MARGIN - tw : MARGIN, y, line.getTextContent(), rtl, byRun);
            y -= Float.parseFloat(attr(line, "after")) + s * 0.25f;
          }
          y -= 6;
          for (Element row : children(pageEl, "row")) {
            boolean head = attr(row, "kind").equals("head");
            PDFont f = head ? bold : regular;
            List<Element> cells = children(row, "cell");
            // Each cell's span of columns and its lines, wrapped to its width.
            List<float[]> spans = new ArrayList<>();
            List<List<String>> texts = new ArrayList<>();
            int col = 0, height = 1;
            float slot = drSlot && !rtl ? width(regular, size, " DR") : 0;
            for (Element c : cells) {
              int span = Integer.parseInt(attr(c, "span"));
              float cw = 0;
              for (int k = col; k < col + span; k++) cw += widths[k];
              float left = MARGIN;
              if (rtl) {
                float right = box.getWidth() - MARGIN;
                for (int k = 0; k < col; k++) right -= widths[k];
                left = right - cw;
              } else {
                for (int k = 0; k < col; k++) left += widths[k];
              }
              spans.add(new float[] {left, cw});
              boolean end = attr(c, "align").equals("end");
              String content = c.getTextContent();
              if (end && !head && content.endsWith(" DR") && slot > 0) {
                content = content.substring(0, content.length() - 3);
              }
              List<String> lines = wrap(content, f, size, cw - 2 * pad - (end && !head ? slot : 0), rtl);
              texts.add(lines);
              height = Math.max(height, lines.size());
              col += span;
            }
            float rowHeight = height * leading + 2 * pad;
            float top = y, bottom = y - rowHeight;
            if (head && heading.equals("filled")) {
              cs.setNonStrokingColor(0.86f, 0.89f, 0.93f);
              cs.addRect(MARGIN, bottom, usable, rowHeight);
              cs.fill();
              cs.setNonStrokingColor(0f, 0f, 0f);
            }
            for (int i = 0; i < cells.size(); i++) {
              Element c = cells.get(i);
              float left = spans.get(i)[0], cw = spans.get(i)[1];
              boolean end = attr(c, "align").equals("end");
              boolean dr = slot > 0 && end && !head && c.getTextContent().endsWith(" DR");
              if (clipCells) {
                cs.saveGraphicsState();
                // A rectangle traced back to its start, not closed: a fill or clip closes it.
                cs.moveTo(left, bottom);
                cs.lineTo(left + cw, bottom);
                cs.lineTo(left + cw, top);
                cs.lineTo(left, top);
                cs.lineTo(left, bottom);
                cs.clip();
              }
              List<String> lines = texts.get(i);
              float reserve = end && !head ? slot : 0;
              for (int k = 0; k < lines.size(); k++) {
                float base = top - pad - leading * (k + 1) + (leading - size) * 0.5f + size * 0.22f;
                float tw = width(f, size, visual(lines.get(k), rtl));
                // Start is the left of a left-to-right cell and the right of a right-to-left one.
                boolean right = end != rtl;
                float x = right ? left + cw - pad - reserve - tw : left + pad;
                line(cs, f, size, x, base, lines.get(k), rtl, byRun);
                if (dr && k == lines.size() - 1) {
                  text(cs, f, size, left + cw - pad - reserve + width(f, size, " "), base, "DR");
                }
              }
              if (clipCells) cs.restoreGraphicsState();
            }
            cs.setStrokingColor(0.55f, 0.55f, 0.55f);
            cs.setLineWidth(0.4f);
            if (rules.equals("grid")) {
              for (int i = 0; i < cells.size(); i++) {
                float left = spans.get(i)[0], cw = spans.get(i)[1];
                cs.addRect(left, bottom, cw, rowHeight);
              }
              cs.stroke();
            } else if (rules.equals("rows") && !head) {
              cs.moveTo(MARGIN, bottom);
              cs.lineTo(MARGIN + usable, bottom);
              cs.stroke();
            }
            if (head && heading.equals("rule") && !rules.equals("grid")) {
              cs.setLineWidth(0.9f);
              cs.moveTo(MARGIN, bottom);
              cs.lineTo(MARGIN + usable, bottom);
              cs.stroke();
            }
            cs.setStrokingColor(0f, 0f, 0f);
            y = bottom;
          }
          for (Element foot : children(pageEl, "footer")) {
            float tw = width(regular, size, visual(foot.getTextContent(), rtl));
            line(cs, regular, size, (box.getWidth() - tw) / 2, MARGIN - size, foot.getTextContent(), rtl, byRun);
          }
        }
      }
      doc.save(new File(attr(st, "out")));
    }
  }
}
