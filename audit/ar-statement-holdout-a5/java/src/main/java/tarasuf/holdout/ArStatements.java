package tarasuf.holdout;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.itextpdf.io.font.PdfEncodings;
import com.itextpdf.kernel.colors.DeviceRgb;
import com.itextpdf.kernel.font.PdfFont;
import com.itextpdf.kernel.font.PdfFontFactory;
import com.itextpdf.kernel.geom.PageSize;
import com.itextpdf.kernel.pdf.PdfDocument;
import com.itextpdf.kernel.pdf.PdfWriter;
import com.itextpdf.layout.Document;
import com.itextpdf.layout.borders.Border;
import com.itextpdf.layout.borders.SolidBorder;
import com.itextpdf.layout.element.AreaBreak;
import com.itextpdf.layout.element.Cell;
import com.itextpdf.layout.element.Paragraph;
import com.itextpdf.layout.element.Table;
import com.itextpdf.layout.properties.AreaBreakType;
import com.itextpdf.layout.properties.TextAlignment;
import com.itextpdf.layout.properties.UnitValue;
import com.itextpdf.layout.properties.VerticalAlignment;
import java.io.File;

/**
 * The A5 iText statements: a Java statement service drawing with iText Core
 * (AGPL), used outside the repository to write the holdout's test files.
 * Each printed page of the facts is laid out by iText's layout engine on its
 * own page: its text lines as paragraphs, each run of heading and value lines
 * as a fixed-layout table whose columns have the width of their role. The
 * page footer, when the story prints one, is placed after layout at the foot
 * of its page. Fonts are created from their files in WinAnsi or Identity-H,
 * as the story says, and iText subsets and embeds them.
 */
public final class ArStatements {
  public static void main(String[] args) throws Exception {
    JsonNode jobs = new ObjectMapper().readTree(new File(args[0]));
    for (JsonNode job : jobs.get("statements")) {
      draw(job);
    }
  }

  private static PdfFont font(JsonNode job, String key) throws Exception {
    String encoding =
        "identity".equals(job.get("encoding").asText()) ? PdfEncodings.IDENTITY_H : PdfEncodings.WINANSI;
    return PdfFontFactory.createFont(
        job.get(key).asText(), encoding, PdfFontFactory.EmbeddingStrategy.FORCE_EMBEDDED);
  }

  private static void draw(JsonNode job) throws Exception {
    PdfDocument pdf = new PdfDocument(new PdfWriter(job.get("out").asText()));
    pdf.getDocumentInfo().setTitle("Statement of account");
    pdf.getDocumentInfo().setCreator("Synthetic iText statement service (AR-1 PDF A5 holdout)");
    Document doc = new Document(pdf, PageSize.A4, false);
    doc.setMargins(40, 36, 40, 36);
    PdfFont regular = font(job, "regular");
    PdfFont bold = font(job, "bold");
    float size = (float) job.get("size").asDouble();
    String grid = job.get("grid").asText();
    DeviceRgb shade = null;
    if (job.hasNonNull("shade")) {
      int rgb = Integer.parseInt(job.get("shade").asText(), 16);
      shade = new DeviceRgb((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
    }
    JsonNode pages = job.get("pages");
    for (int p = 0; p < pages.size(); p++) {
      if (p > 0) {
        doc.add(new AreaBreak(AreaBreakType.NEXT_PAGE));
      }
      for (JsonNode block : pages.get(p).get("blocks")) {
        if ("text".equals(block.get("kind").asText())) {
          boolean title = block.get("title").asBoolean();
          doc.add(new Paragraph(block.get("text").asText())
              .setFont(title ? bold : regular)
              .setFontSize(title ? 12 : 9)
              .setMargin(0)
              .setMarginBottom(title ? 4 : 0)
              .setMultipliedLeading(1.2f));
          continue;
        }
        JsonNode widths = block.get("widths");
        float[] points = new float[widths.size()];
        for (int i = 0; i < points.length; i++) {
          points[i] = (float) widths.get(i).asDouble();
        }
        Table table = new Table(UnitValue.createPointArray(points)).setFixedLayout();
        table.setMarginTop(4).setMarginBottom(3);
        JsonNode end = block.get("end");
        for (JsonNode row : block.get("rows")) {
          boolean heading = row.get("heading").asBoolean();
          JsonNode cells = row.get("cells");
          for (int i = 0; i < cells.size(); i++) {
            Cell cell = new Cell()
                .add(new Paragraph(cells.get(i).asText())
                    .setFont(heading ? bold : regular)
                    .setFontSize(size)
                    .setMargin(0)
                    .setMultipliedLeading(1.0f))
                .setPaddingTop(1.5f).setPaddingBottom(1.5f).setPaddingLeft(2.5f).setPaddingRight(2.5f)
                .setTextAlignment(end.get(i).asBoolean() ? TextAlignment.RIGHT : TextAlignment.LEFT);
            if ("rules".equals(grid)) {
              cell.setBorder(Border.NO_BORDER);
              if (heading) {
                cell.setBorderBottom(new SolidBorder(0.5f));
              }
            } else {
              cell.setBorder(new SolidBorder(0.5f));
            }
            if (heading && shade != null) {
              cell.setBackgroundColor(shade);
            }
            table.addCell(cell);
          }
        }
        doc.add(table);
      }
    }
    float middle = PageSize.A4.getWidth() / 2;
    for (int p = 0; p < pages.size(); p++) {
      JsonNode footer = pages.get(p).get("footer");
      if (footer != null && !footer.isNull()) {
        doc.showTextAligned(new Paragraph(footer.asText()).setFont(regular).setFontSize(8),
            middle, 22, p + 1, TextAlignment.CENTER, VerticalAlignment.BOTTOM, 0);
      }
    }
    doc.close();
  }
}
