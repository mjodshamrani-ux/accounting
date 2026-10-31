package tarasuf.holdout;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.io.font.PdfEncodings;
import com.itextpdf.kernel.colors.Color;
import com.itextpdf.kernel.colors.DeviceRgb;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.font.PdfFontFactory;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfDocumentInfo;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.borders.Border;
import com.itextpdf.layout.borders.SolidBorder;
import com.itextpdf.layout.element.AreaBreak;
import com.itextpdf.layout.element.Cell;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import com.itextpdf.layout.properties.TextAlignment;
import com.itextpdf.layout.properties.UnitValue;
import com.itextpdf.layout.properties.VerticalAlignment;
import java.io.File;
import java.util.Map;

/**
 * The G20 iText statements: a Java statement service drawing each page of the facts with iText Core.
 *
 * <p>Each page is one iText table of seven columns under the bank's heading, the footer placed at
 * the page's foot as the facts number the page; a page whose table would not fit is an error, not a
 * page break. The fonts are created from the story's files as iText offers them: in iText's default
 * simple encoding (WinAnsi), so that a TrueType file is written as a simple TrueType subset and an
 * OpenType CFF file whole as a simple Type1C font, or in Identity-H as a Type0 subset. iText Core
 * lays out no right-to-left text without its commercial add-on, so the statements are English. The
 * document dates are fixed, so they do not depend on the clock; iText draws its subset prefixes and
 * its document identifier itself.
 *
 * <p>Reads the statements.json render_itext.py writes.
 */
public final class Statements {
  private static final String STAMP = "D:20290131120000Z";
  private static final Map<String, PageSize> PAPER =
      Map.of("A4", PageSize.A4, "Letter", PageSize.LETTER, "A4-landscape", PageSize.A4.rotate());
  private static final float[] WIDTHS = {10, 10, 31, 16, 11, 11, 11};
  private static final Color RULE = new DeviceRgb(0x59, 0x59, 0x59);
  private static final Color STRIPE = new DeviceRgb(0xF1, 0xF3, 0xF5);

  private Statements() {}

  private static Color colour(String hex) {
    return new DeviceRgb(
        Integer.parseInt(hex.substring(0, 2), 16),
        Integer.parseInt(hex.substring(2, 4), 16),
        Integer.parseInt(hex.substring(4, 6), 16));
  }

  private static PdfFont font(String path, String encoding) throws Exception {
    return PdfFontFactory.createFont(
        path,
        "identity".equals(encoding) ? PdfEncodings.IDENTITY_H : PdfEncodings.WINANSI,
        PdfFontFactory.EmbeddingStrategy.PREFER_EMBEDDED);
  }

  private static Cell cell(String text, PdfFont font, float size, TextAlignment align, int colspan) {
    Cell c = new Cell(1, colspan).add(new Paragraph(text).setFont(font).setFontSize(size)
        .setMultipliedLeading(1.15f).setMargin(0).setTextAlignment(align));
    c.setPaddingTop(3).setPaddingBottom(3).setPaddingLeft(3.5f).setPaddingRight(3.5f);
    c.setVerticalAlignment(VerticalAlignment.TOP);
    return c;
  }

  private static void borders(Cell c, String rules, boolean heading) {
    if ("grid".equals(rules)) {
      c.setBorder(new SolidBorder(RULE, 0.5f));
      return;
    }
    c.setBorder(Border.NO_BORDER);
    if (heading) {
      c.setBorderBottom(new SolidBorder(0.8f));
    } else if ("rows".equals(rules)) {
      c.setBorderBottom(new SolidBorder(RULE, 0.4f));
    }
  }

  static void statement(JsonNode job) throws Exception {
    JsonNode style = job.get("style");
    String rules = style.path("rules").asText("grid");
    String heading = style.path("heading").asText("rule");
    boolean left = "left".equals(style.path("headings").asText(""));
    PdfDocument pdf = new PdfDocument(new PdfWriter(job.get("out").asText()));
    PdfDocumentInfo info = pdf.getDocumentInfo();
    info.setTitle(job.get("title").asText() + " " + job.get("number").asText());
    info.setAuthor(job.get("bank").asText());
    info.setCreator("G20 statement service (iText)");
    info.setMoreInfo("CreationDate", STAMP);
    info.setMoreInfo("ModDate", STAMP);
    PageSize size = PAPER.get(job.get("paper").asText());
    Document doc = new Document(pdf, size);
    doc.setMargins(34, 34, 34, 34);
    PdfFont regular = font(job.get("regular").asText(), job.get("encoding").asText());
    PdfFont bold = font(job.get("bold").asText(), job.get("encoding").asText());
    float body = (float) job.get("size").asDouble();
    Color fill = colour(job.get("fill").asText());
    JsonNode pages = job.get("pages");
    for (int index = 0; index < pages.size(); index++) {
      JsonNode page = pages.get(index);
      if (index > 0) {
        doc.add(new AreaBreak());
      }
      doc.add(new Paragraph(job.get("bank").asText()).setFont(bold).setFontSize(13.5f).setMargin(0));
      int number = pdf.getNumberOfPages();
      doc.add(new Paragraph(job.get("title").asText()).setFont(regular).setFontSize(10.5f).setMarginTop(2)
          .setMarginBottom(0));
      doc.add(new Paragraph(job.get("account").asText()).setFont(regular).setFontSize(8.2f).setMarginTop(2)
          .setMarginBottom(8));
      Table table = new Table(UnitValue.createPercentArray(WIDTHS)).useAllAvailableWidth();
      JsonNode headers = job.get("headers");
      for (int k = 0; k < 7; k++) {
        TextAlignment align = k >= 4 && !left ? TextAlignment.RIGHT : TextAlignment.LEFT;
        Cell c = cell(headers.get(k).asText(), bold, body, align, 1);
        borders(c, rules, true);
        if ("filled".equals(heading)) {
          c.setBackgroundColor(fill).setFontColor(DeviceRgb.WHITE);
        }
        table.addHeaderCell(c);
      }
      JsonNode rows = page.get("rows");
      for (int r = 0; r < rows.size(); r++) {
        JsonNode row = rows.get(r);
        JsonNode cells = row.get("cells");
        Cell[] made;
        switch (row.get("kind").asText()) {
          case "movement" -> {
            made = new Cell[7];
            for (int k = 0; k < 7; k++) {
              made[k] = cell(cells.get(k).asText(), regular, body,
                  k >= 4 ? TextAlignment.RIGHT : TextAlignment.LEFT, 1);
            }
          }
          case "label" -> made = new Cell[] {
              cell(cells.get(0).asText(), bold, body, TextAlignment.LEFT, 4),
              cell("", regular, body, TextAlignment.LEFT, 1), cell("", regular, body, TextAlignment.LEFT, 1),
              cell(cells.get(1).asText(), bold, body, TextAlignment.RIGHT, 1)};
          case "totals" -> made = new Cell[] {
              cell(cells.get(0).asText(), bold, body, TextAlignment.LEFT, 4),
              cell(cells.get(1).asText(), bold, body, TextAlignment.RIGHT, 1),
              cell(cells.get(2).asText(), bold, body, TextAlignment.RIGHT, 1),
              cell("", regular, body, TextAlignment.LEFT, 1)};
          case "continuation" -> made = new Cell[] {
              cell("", regular, body, TextAlignment.LEFT, 1), cell("", regular, body, TextAlignment.LEFT, 1),
              cell(cells.get(0).asText(), regular, body, TextAlignment.LEFT, 1),
              cell("", regular, body, TextAlignment.LEFT, 1), cell("", regular, body, TextAlignment.LEFT, 1),
              cell("", regular, body, TextAlignment.LEFT, 1), cell("", regular, body, TextAlignment.LEFT, 1)};
          default -> throw new IllegalArgumentException(row.get("kind").asText());
        }
        for (Cell c : made) {
          borders(c, rules, false);
          if ("stripes".equals(rules) && r % 2 == 1) {
            c.setBackgroundColor(STRIPE);
          }
          table.addCell(c);
        }
      }
      doc.add(table);
      if (pdf.getNumberOfPages() != number) {
        throw new IllegalStateException(job.get("id").asText() + " page " + (index + 1)
            + ": the table runs onto another page");
      }
      doc.showTextAligned(new Paragraph(page.get("footer").asText()).setFont(regular).setFontSize(8),
          size.getWidth() - 34, 22, number, TextAlignment.RIGHT, VerticalAlignment.BOTTOM, 0);
    }
    doc.close();
  }

  public static void main(String[] args) throws Exception {
    JsonNode all = new ObjectMapper().readTree(new File(args[0]));
    for (JsonNode job : all.get("statements")) {
      statement(job);
    }
  }
}
