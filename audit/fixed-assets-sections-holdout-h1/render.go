// FA-1 H1 (copied from the PG-1 H1 writers), the Go writer: encoding/csv with UseCRLF, which quotes a field
// holding the separator, a quote or a line break or beginning with a space,
// and writes every line break, inside a field too, as CRLF; the separator is
// the job's, a comma unless it says otherwise. Reads [{path, cells, comma}]
// as JSON on stdin.
package main

import (
	"encoding/csv"
	"encoding/json"
	"os"
)

type job struct {
	Path  string     `json:"path"`
	Cells [][]string `json:"cells"`
	Comma string     `json:"comma"`
}

func main() {
	var jobs []job
	if err := json.NewDecoder(os.Stdin).Decode(&jobs); err != nil {
		panic(err)
	}
	for _, j := range jobs {
		f, err := os.Create(j.Path)
		if err != nil {
			panic(err)
		}
		w := csv.NewWriter(f)
		w.UseCRLF = true
		if j.Comma != "" {
			w.Comma = []rune(j.Comma)[0]
		}
		for _, row := range j.Cells {
			if len(row) == 0 {
				w.Flush()
				f.WriteString("\r\n")
				continue
			}
			if err := w.Write(row); err != nil {
				panic(err)
			}
		}
		w.Flush()
		if err := w.Error(); err != nil {
			panic(err)
		}
		f.Close()
	}
}
