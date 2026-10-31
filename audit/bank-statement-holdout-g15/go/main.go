// The G15 go-pdf/fpdf statements and excelize cashbooks: a Go application
// drawing its own statement with go-pdf/fpdf, a maintained fork of the
// gofpdf library many Go services use for their documents, and exporting
// its cashbook with excelize.
//
//	go run . statements <statements.json>
//	go run . cashbooks <cashbooks.json>
//
// statements.json (render_gofpdf.py) holds each statement's pages in the
// order the facts print them, each row's cells in logical column order and
// its footer. Every page draws the bank's name, the document title and the
// account line, then the table: the heading row as the style says (filled,
// or grey, or over a rule), then a row per line, as tall as its wrapped
// description, ruled as the style says, then the footer. An Arabic page
// stands its first column on the right. Its text is shaped and ordered by
// arabic.go; a 'runs' statement draws each run of one direction on its own,
// from the right edge of its cell leftwards, and a 'whole' one draws each
// line once, right-aligned.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/go-pdf/fpdf"
	"github.com/xuri/excelize/v2"
)

// The files' fixed dates.
var stamp = time.Date(2027, 1, 31, 12, 0, 0, 0, time.UTC)

type statement struct {
	ID          string    `json:"id"`
	Out         string    `json:"out"`
	Paper       string    `json:"paper"`
	Layout      string    `json:"layout"`
	Family      string    `json:"family"`
	Regular     string    `json:"regular"`
	Bold        string    `json:"bold"`
	Size        float64   `json:"size"`
	Row         float64   `json:"row"`
	Style       style     `json:"style"`
	Widths      []float64 `json:"widths"`
	HeadingFill [3]int    `json:"headingFill"`
	Headers     []string  `json:"headers"`
	Bank        string    `json:"bank"`
	Title       string    `json:"documentTitle"`
	AccountLine string    `json:"accountLine"`
	Pages       []page    `json:"pages"`
	Unmapped    []rune    `json:"unmapped"`
}

type style struct {
	Rules   string `json:"rules"`
	Heading string `json:"heading"`
	Bidi    string `json:"bidi"`
}

type page struct {
	Rows   []row  `json:"rows"`
	Footer string `json:"footer"`
}

type row struct {
	Kind  string   `json:"kind"`
	Cells []string `json:"cells"`
}

const margin = 36.0
const pad = 3.0

type writer struct {
	pdf *fpdf.Fpdf
	s   statement
	x   []float64 // each logical column's left edge
}

func (w *writer) rtl() bool { return w.s.Layout == "ar" }

func (w *writer) width(text string) float64 {
	if w.rtl() {
		return w.pdf.GetStringWidth(visual(text))
	}
	return w.pdf.GetStringWidth(text)
}

// draw writes one line of text in the box [left, right] at baseline y,
// aligned to the right edge or the left one.
func (w *writer) draw(text string, left, right, y float64, toRight bool) {
	if text == "" {
		return
	}
	if !w.rtl() {
		x := left
		if toRight {
			x = right - w.pdf.GetStringWidth(text)
		}
		w.pdf.Text(x, y, text)
		return
	}
	if w.s.Style.Bidi == "whole" || !toRight {
		v := visual(text)
		x := right - w.pdf.GetStringWidth(v)
		if !toRight {
			x = left
		}
		w.pdf.Text(x, y, v)
		return
	}
	x := right
	for _, r := range runs(text) {
		x -= w.pdf.GetStringWidth(r.text)
		w.pdf.Text(x, y, r.text)
	}
}

// wrap breaks a description into lines that fit the width, at spaces.
func (w *writer) wrap(text string, width float64) []string {
	var lines []string
	line := ""
	for _, word := range strings.Fields(text) {
		next := word
		if line != "" {
			next = line + " " + word
		}
		if line != "" && w.width(next) > width {
			lines = append(lines, line)
			line = word
		} else {
			line = next
		}
	}
	return append(lines, line)
}

// span returns the left and right edges of logical columns a..b.
func (w *writer) span(a, b int) (float64, float64) {
	left, right := w.x[a], w.x[a]+w.s.Widths[a]
	for c := a; c <= b; c++ {
		left = min(left, w.x[c])
		right = max(right, w.x[c]+w.s.Widths[c])
	}
	return left, right
}

func (w *writer) rule(y float64) {
	left, right := w.span(0, len(w.s.Widths)-1)
	w.pdf.Line(left, y, right, y)
}

// grid rules a row's cells; a control line's label spans the first four
// columns, which are not divided. Each column's left edge is ruled, and the
// table's right edge: in a right-to-left table a column's left edge divides
// it from the next column.
func (w *writer) grid(top, bottom float64, spanned bool) {
	left, right := w.span(0, len(w.s.Widths)-1)
	w.pdf.Line(left, top, right, top)
	w.pdf.Line(left, bottom, right, bottom)
	inside := func(c int) bool { return c >= 1 && c <= 3 }
	if w.rtl() {
		inside = func(c int) bool { return c <= 2 }
	}
	for c := range w.s.Widths {
		if spanned && inside(c) {
			continue
		}
		w.pdf.Line(w.x[c], top, w.x[c], bottom)
	}
	w.pdf.Line(right, top, right, bottom)
}

func (w *writer) baseline(top float64, line int) float64 {
	return top + float64(line)*w.s.Row + (w.s.Row-w.s.Size)/2 + w.s.Size*0.78
}

func (w *writer) page(p page, number int) {
	pdf, s := w.pdf, w.s
	pdf.AddPage()
	pageW, _ := pdf.GetPageSize()
	pdf.SetTextColor(0, 0, 0)
	pdf.SetFont(s.Family, "B", s.Size+4)
	w.draw(s.Bank, margin, pageW-margin, margin+12, w.rtl())
	pdf.SetFont(s.Family, "", s.Size+2)
	w.draw(s.Title, margin, pageW-margin, margin+28, w.rtl())
	pdf.SetFont(s.Family, "", s.Size)
	w.draw(s.AccountLine, margin, pageW-margin, margin+44, w.rtl())
	top := margin + 58.0
	amount := func(c int) bool { return c >= 4 }
	// The heading row.
	pdf.SetFont(s.Family, "B", s.Size)
	switch s.Style.Heading {
	case "filled":
		pdf.SetFillColor(s.HeadingFill[0], s.HeadingFill[1], s.HeadingFill[2])
		left, right := w.span(0, len(s.Widths)-1)
		pdf.Rect(left, top, right-left, s.Row, "F")
		pdf.SetTextColor(255, 255, 255)
	case "grey":
		pdf.SetFillColor(228, 228, 228)
		left, right := w.span(0, len(s.Widths)-1)
		pdf.Rect(left, top, right-left, s.Row, "F")
	}
	for c, h := range s.Headers {
		w.draw(h, w.x[c]+pad, w.x[c]+s.Widths[c]-pad, w.baseline(top, 0), w.rtl() || amount(c))
	}
	pdf.SetTextColor(0, 0, 0)
	pdf.SetDrawColor(120, 120, 120)
	pdf.SetLineWidth(0.4)
	if s.Style.Heading == "rule" || s.Style.Rules == "none" || s.Style.Rules == "stripes" {
		w.rule(top + s.Row)
	}
	if s.Style.Rules == "grid" {
		w.grid(top, top+s.Row, false)
	}
	y := top + s.Row
	for i, r := range p.Rows {
		lines := 1
		var wrapped []string
		if r.Kind == "movement" {
			wrapped = w.wrap(r.Cells[2], s.Widths[2]-2*pad)
			lines = len(wrapped)
		}
		height := float64(lines) * s.Row
		if s.Style.Rules == "stripes" && i%2 == 1 {
			pdf.SetFillColor(238, 243, 247)
			left, right := w.span(0, len(s.Widths)-1)
			pdf.Rect(left, y, right-left, height, "F")
		}
		bold := r.Kind != "movement" && r.Kind != "continuation"
		if bold {
			pdf.SetFont(s.Family, "B", s.Size)
		} else {
			pdf.SetFont(s.Family, "", s.Size)
		}
		switch r.Kind {
		case "movement":
			for c, text := range r.Cells {
				if c == 2 {
					for k, line := range wrapped {
						w.draw(line, w.x[c]+pad, w.x[c]+s.Widths[c]-pad, w.baseline(y, k), w.rtl())
					}
					continue
				}
				w.draw(text, w.x[c]+pad, w.x[c]+s.Widths[c]-pad, w.baseline(y, 0), w.rtl() || amount(c))
			}
		case "label":
			left, right := w.span(0, 3)
			w.draw(r.Cells[0], left+pad, right-pad, w.baseline(y, 0), w.rtl())
			w.draw(r.Cells[1], w.x[6]+pad, w.x[6]+s.Widths[6]-pad, w.baseline(y, 0), true)
		case "totals":
			left, right := w.span(0, 3)
			w.draw(r.Cells[0], left+pad, right-pad, w.baseline(y, 0), w.rtl())
			w.draw(r.Cells[1], w.x[4]+pad, w.x[4]+s.Widths[4]-pad, w.baseline(y, 0), true)
			w.draw(r.Cells[2], w.x[5]+pad, w.x[5]+s.Widths[5]-pad, w.baseline(y, 0), true)
		case "continuation":
			w.draw(r.Cells[0], w.x[2]+pad, w.x[2]+s.Widths[2]-pad, w.baseline(y, 0), w.rtl())
		}
		switch s.Style.Rules {
		case "rows":
			w.rule(y + height)
		case "grid":
			w.grid(y, y+height, r.Kind == "label" || r.Kind == "totals")
		}
		y += height
	}
	if s.Style.Rules == "stripes" || s.Style.Rules == "none" {
		w.rule(y)
	}
	pdf.SetFont(s.Family, "", s.Size)
	left, right := w.span(0, len(s.Widths)-1)
	footerWidth := w.width(p.Footer)
	middle := (left + right) / 2
	w.draw(p.Footer, middle-footerWidth/2, middle+footerWidth/2, y+2.4*s.Row, true)
}

func render(s statement) error {
	orientation, size := "P", "A4"
	switch s.Paper {
	case "A4-landscape":
		orientation = "L"
	case "Letter":
		size = "Letter"
	}
	unmapped = map[rune]bool{}
	for _, r := range s.Unmapped {
		unmapped[r] = true
	}
	pdf := fpdf.New(orientation, "pt", size, "")
	pdf.SetCreationDate(stamp)
	pdf.SetModificationDate(stamp)
	pdf.SetCatalogSort(true)
	pdf.SetAutoPageBreak(false, 0)
	pdf.SetMargins(margin, margin, margin)
	regular, err := os.ReadFile(s.Regular)
	if err != nil {
		return err
	}
	bold, err := os.ReadFile(s.Bold)
	if err != nil {
		return err
	}
	pdf.AddUTF8FontFromBytes(s.Family, "", regular)
	pdf.AddUTF8FontFromBytes(s.Family, "B", bold)
	pageW, _ := pdf.GetPageSize()
	w := &writer{pdf: pdf, s: s}
	total := 0.0
	for _, width := range s.Widths {
		total += width
	}
	// Logical columns from the left, or from the right for Arabic.
	x := margin + (pageW-2*margin-total)/2
	w.x = make([]float64, len(s.Widths))
	for c := range s.Widths {
		if w.rtl() {
			w.x[c] = pageW - x - s.Widths[c]
			x += s.Widths[c]
			continue
		}
		w.x[c] = x
		x += s.Widths[c]
	}
	for n, p := range s.Pages {
		w.page(p, n+1)
	}
	var out bytes.Buffer
	if err := pdf.Output(&out); err != nil {
		return err
	}
	return os.WriteFile(s.Out, withoutNames(out.Bytes()), 0o644)
}

// emptyNames is the name dictionary go-pdf/fpdf writes into every catalog,
// an embedded-files tree with no file. The repository publishes no PDF that
// names embedded files (scripts/public-content-check.mjs), so the
// application blanks it to as many spaces: every byte offset stands, and the
// catalog keeps its type and pages.
var emptyNames = []byte("/Names <<\n/EmbeddedFiles << /Names [\n  \n] >>\n>>\n")

func withoutNames(pdf []byte) []byte {
	if bytes.Count(pdf, emptyNames) != 1 {
		panic("the catalog's empty name tree is not there once")
	}
	return bytes.Replace(pdf, emptyNames, bytes.Repeat([]byte(" "), len(emptyNames)), 1)
}

type cashbook struct {
	Out     string   `json:"out"`
	Kind    string   `json:"kind"`
	Headers []string `json:"headers"`
	Entries []struct {
		Date        string `json:"date"`
		Voucher     string `json:"voucher"`
		Description string `json:"description"`
		Reference   string `json:"reference"`
		Receipt     int64  `json:"receipt"`
		Payment     int64  `json:"payment"`
	} `json:"entries"`
}

// writeCashbook exports a cashbook as an application does with excelize: the
// CSV's headers on the first row, then one entry per row. A 'typed' cashbook
// holds its dates as Excel dates shown yyyy-mm-dd and its amounts as numbers
// shown #,##0.00, an empty amount left empty; a 'text' one holds every cell
// as the CSV's text.
func writeCashbook(b cashbook) error {
	f := excelize.NewFile()
	defer f.Close()
	sheet := "Cashbook"
	if err := f.SetSheetName("Sheet1", sheet); err != nil {
		return err
	}
	if err := f.SetDocProps(&excelize.DocProperties{Creator: "excelize", LastModifiedBy: "excelize",
		Created: stamp.Format(time.RFC3339), Modified: stamp.Format(time.RFC3339)}); err != nil {
		return err
	}
	dateFormat := "yyyy-mm-dd"
	moneyFormat := "#,##0.00"
	dates, err := f.NewStyle(&excelize.Style{CustomNumFmt: &dateFormat})
	if err != nil {
		return err
	}
	money, err := f.NewStyle(&excelize.Style{CustomNumFmt: &moneyFormat})
	if err != nil {
		return err
	}
	cell := func(col, row int) string {
		name, _ := excelize.CoordinatesToCellName(col, row)
		return name
	}
	for i, h := range b.Headers {
		if err := f.SetCellStr(sheet, cell(i+1, 1), h); err != nil {
			return err
		}
	}
	for r, e := range b.Entries {
		row := r + 2
		if b.Kind == "typed" {
			when, err := time.Parse("2006-01-02", e.Date)
			if err != nil {
				return err
			}
			if err := f.SetCellValue(sheet, cell(1, row), when); err != nil {
				return err
			}
			if err := f.SetCellStyle(sheet, cell(1, row), cell(1, row), dates); err != nil {
				return err
			}
		} else if err := f.SetCellStr(sheet, cell(1, row), e.Date); err != nil {
			return err
		}
		for k, text := range []string{e.Voucher, e.Description, e.Reference} {
			if err := f.SetCellStr(sheet, cell(k+2, row), text); err != nil {
				return err
			}
		}
		for k, minor := range []int64{e.Receipt, e.Payment} {
			if minor == 0 {
				continue
			}
			at := cell(k+5, row)
			if b.Kind == "typed" {
				if err := f.SetCellFloat(sheet, at, float64(minor)/100, 2, 64); err != nil {
					return err
				}
				if err := f.SetCellStyle(sheet, at, at, money); err != nil {
					return err
				}
			} else if err := f.SetCellStr(sheet, at, fmt.Sprintf("%d.%02d", minor/100, minor%100)); err != nil {
				return err
			}
		}
	}
	return f.SaveAs(b.Out)
}

func main() {
	if len(os.Args) != 3 {
		fmt.Fprintln(os.Stderr, "usage: go run . statements|cashbooks <file.json>")
		os.Exit(2)
	}
	data, err := os.ReadFile(os.Args[2])
	if err != nil {
		panic(err)
	}
	switch os.Args[1] {
	case "statements":
		var job struct{ Statements []statement }
		if err := json.Unmarshal(data, &job); err != nil {
			panic(err)
		}
		for _, s := range job.Statements {
			if err := render(s); err != nil {
				panic(fmt.Errorf("%s: %w", s.ID, err))
			}
		}
	case "cashbooks":
		var job struct{ Cashbooks []cashbook }
		if err := json.Unmarshal(data, &job); err != nil {
			panic(err)
		}
		for _, b := range job.Cashbooks {
			if err := writeCashbook(b); err != nil {
				panic(fmt.Errorf("%s: %w", b.Out, err))
			}
		}
	default:
		panic("statements or cashbooks")
	}
}
