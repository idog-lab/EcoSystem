# Merge Mania economy toolkit

Event-economy design tool for Merge Mania (Disney Solitaire live-ops). Also
hosts two smaller tools: Diamond Mine and Chef.

- [CLAUDE.md](./CLAUDE.md) - the rules the app follows today, and a map of the code.
- [docs/history.md](./docs/history.md) - the full design history behind those rules.

## Commands

```
npm install
npm run dev       # http://localhost:5173/EcoSystem/
npm run build
npm run lint
npm run verify    # engine checks
npm run e2e       # browser checks (needs npm run dev running)
# The site (https://idog-lab.github.io/EcoSystem/) is published by GitHub
# whenever a pull request is merged into master (.github/workflows/deploy.yml).
```

## Folders

- `src/` - the app (`src/features/merge`, `diamondMine`, `chef`; shared UI in `src/components`).
- `scripts/verify`, `scripts/e2e`, `scripts/art` - checks and the artwork preparation.
- `art-source/`, `reference/` - the economist's own asset packs and reference spreadsheets (not in git).
- `docs/` - design history.
