// GLT-1 holdout H1, the Go writer: encoding/csv with its defaults (quotes only
// where needed, LF). Reads [{path, cells}] as JSON on stdin.
package main

import (
	"encoding/csv"
	"encoding/json"
	"os"
)

type file struct {
	Path  string     `json:"path"`
	Cells [][]string `json:"cells"`
}

func main() {
	var files []file
	if err := json.NewDecoder(os.Stdin).Decode(&files); err != nil {
		panic(err)
	}
	for _, f := range files {
		out, err := os.Create(f.Path)
		if err != nil {
			panic(err)
		}
		w := csv.NewWriter(out)
		if err := w.WriteAll(f.Cells); err != nil {
			panic(err)
		}
		out.Close()
	}
}
