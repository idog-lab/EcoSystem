# The model catalog

Seven models, from `src/platform/registry/catalog.ts`. A workbook source is
what the brief said, nothing more: the workbook itself was not opened for this
work, and nothing about a model's economics is inferred from sheet names.

| Model | URL | In this app | Workbook sheet family | How sure |
|---|---|---|---|---|
| Merge Mania | `/models/merge-mania` | existing editor | Merge | stated |
| Diamond Mine | `/models/diamond-mine` | existing tool | its own family ("Diamond Mine"?) | name not checked |
| Chef | `/models/chef` | existing flow | none recorded | no verified one-to-one mapping |
| Economy | `/models/economy` | existing page | none recorded | no verified one-to-one mapping |
| Momentum | `/models/momentum` | Model not migrated yet | its own family ("Momentum"?) | name not checked |
| Challenge | `/models/challenge` | Model not migrated yet | Challenges | stated |
| Puzzle | `/models/puzzle` | Model not migrated yet | its own family ("Puzzle"?) | name not checked |

"Name not checked": the brief says these have corresponding sheet families,
and the family name is assumed to be the model's name until someone checks it
against the workbook (`status: 'name-unverified'`).

The workbook never goes into git (`*.xlsx`, `*.xlsm`, `*.xls` and `reference/`
are ignored).
