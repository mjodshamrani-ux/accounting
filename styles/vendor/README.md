# Static shadcn styles

`shadcn-4.18.0.tailwind.css` is the unmodified `dist/tailwind.css` from the already installed, pinned `shadcn@4.18.0` package. Its SHA-256 is `bc7d83425702955b4cb67cb14ede9d603f9d912376d57a2d81d661094d2a782a`. The original MIT notice is preserved in `shadcn.LICENSE.txt`.

The website uses this stylesheet, but never executes the component-generator CLI. Keeping the static stylesheet locally removes that CLI and its dependency graph from production without changing the styles. `@shadcn/react` is a separate runtime dependency and remains installed.
