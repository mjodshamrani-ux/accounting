package main

import (
	"strings"

	"golang.org/x/text/unicode/bidi"
)

// The application's own Arabic: go-pdf/fpdf draws code points as the font
// maps them and neither shapes nor orders text. Letters are shaped here into
// the presentation forms the font maps (isolated, final, initial, medial),
// lam with alef into its ligature, and each line is ordered by
// golang.org/x/text/unicode/bidi, as a Go application drawing Arabic does.

// forms: isolated, final, initial, medial; zero where the letter has none
// (it joins only the letter before it).
var forms = map[rune][4]rune{
	0x0621: {0xFE80, 0, 0, 0},
	0x0622: {0xFE81, 0xFE82, 0, 0},
	0x0623: {0xFE83, 0xFE84, 0, 0},
	0x0624: {0xFE85, 0xFE86, 0, 0},
	0x0625: {0xFE87, 0xFE88, 0, 0},
	0x0626: {0xFE89, 0xFE8A, 0xFE8B, 0xFE8C},
	0x0627: {0xFE8D, 0xFE8E, 0, 0},
	0x0628: {0xFE8F, 0xFE90, 0xFE91, 0xFE92},
	0x0629: {0xFE93, 0xFE94, 0, 0},
	0x062A: {0xFE95, 0xFE96, 0xFE97, 0xFE98},
	0x062B: {0xFE99, 0xFE9A, 0xFE9B, 0xFE9C},
	0x062C: {0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0},
	0x062D: {0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4},
	0x062E: {0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8},
	0x062F: {0xFEA9, 0xFEAA, 0, 0},
	0x0630: {0xFEAB, 0xFEAC, 0, 0},
	0x0631: {0xFEAD, 0xFEAE, 0, 0},
	0x0632: {0xFEAF, 0xFEB0, 0, 0},
	0x0633: {0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4},
	0x0634: {0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8},
	0x0635: {0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC},
	0x0636: {0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0},
	0x0637: {0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4},
	0x0638: {0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8},
	0x0639: {0xFEC9, 0xFECA, 0xFECB, 0xFECC},
	0x063A: {0xFECD, 0xFECE, 0xFECF, 0xFED0},
	0x0641: {0xFED1, 0xFED2, 0xFED3, 0xFED4},
	0x0642: {0xFED5, 0xFED6, 0xFED7, 0xFED8},
	0x0643: {0xFED9, 0xFEDA, 0xFEDB, 0xFEDC},
	0x0644: {0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0},
	0x0645: {0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4},
	0x0646: {0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8},
	0x0647: {0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC},
	0x0648: {0xFEED, 0xFEEE, 0, 0},
	0x0649: {0xFEEF, 0xFEF0, 0, 0},
	0x064A: {0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4},
}

// lam with alef, alef with madda, hamza above and hamza below: isolated, final.
var lamAlef = map[rune][2]rune{
	0x0622: {0xFEF5, 0xFEF6},
	0x0623: {0xFEF7, 0xFEF8},
	0x0625: {0xFEF9, 0xFEFA},
	0x0627: {0xFEFB, 0xFEFC},
}

// unmapped holds the presentation forms the statement's font does not map:
// such a form is drawn as its base letter, whose glyph the font maps.
var unmapped = map[rune]bool{}

func mapped(form, base rune) rune {
	if unmapped[form] {
		return base
	}
	return form
}

func joinsNext(r rune) bool { f, ok := forms[r]; return ok && f[2] != 0 }
func joinsPrev(r rune) bool { _, ok := forms[r]; return ok && r != 0x0621 }

// shape returns the text with its Arabic letters in presentation forms, in
// logical order.
func shape(text string) string {
	in := []rune(text)
	var out []rune
	for i := 0; i < len(in); i++ {
		r := in[i]
		f, ok := forms[r]
		if !ok {
			out = append(out, r)
			continue
		}
		before := i > 0 && joinsNext(in[i-1])
		if r == 0x0644 && i+1 < len(in) {
			if lig, ok := lamAlef[in[i+1]]; ok && !unmapped[lig[0]] && !unmapped[lig[1]] {
				if before {
					out = append(out, lig[1])
				} else {
					out = append(out, lig[0])
				}
				i++
				continue
			}
		}
		after := i+1 < len(in) && joinsPrev(in[i+1]) && f[2] != 0
		switch {
		case before && after:
			out = append(out, mapped(f[3], r))
		case before:
			out = append(out, mapped(f[1], r))
		case after:
			out = append(out, mapped(f[2], r))
		default:
			out = append(out, mapped(f[0], r))
		}
	}
	return string(out)
}

type run struct {
	text string // in drawing order, left to right
	rtl  bool
}

func reverse(s string) string {
	r := []rune(s)
	for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
		r[i], r[j] = r[j], r[i]
	}
	return string(r)
}

// runs returns a right-to-left line's runs in logical order, the first
// standing at the right, each in the order its glyphs are drawn.
func runs(text string) []run {
	var p bidi.Paragraph
	if _, err := p.SetString(shape(text), bidi.DefaultDirection(bidi.RightToLeft)); err != nil {
		panic(err)
	}
	o, err := p.Order()
	if err != nil {
		panic(err)
	}
	var out []run
	for i := 0; i < o.NumRuns(); i++ {
		r := o.Run(i)
		s := r.String()
		if r.Direction() == bidi.RightToLeft {
			out = append(out, run{reverse(s), true})
		} else {
			out = append(out, run{s, false})
		}
	}
	return out
}

// visual returns a right-to-left line as one string in drawing order.
func visual(text string) string {
	rs := runs(text)
	parts := make([]string, len(rs))
	for i, r := range rs {
		parts[len(rs)-1-i] = r.text
	}
	return strings.Join(parts, "")
}
