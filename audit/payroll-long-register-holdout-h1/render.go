// PAY-1 H1, the Go writer: encoding/csv with UseCRLF, which quotes a field
// holding a comma, quote or line break or beginning with a space, and writes
// every line break, inside a field too, as CRLF. Reads [{path, cells}] as
// JSON on stdin.
package main

import (
	"encoding/csv"
	"encoding/json"
	"os"
)

type job struct {
	Path  string     `json:"path"`
	Cells [][]string `json:"cells"`
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
