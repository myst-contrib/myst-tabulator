# myst-tabulator

See [Jupyter outputs](jupyter.md) for live `{code-cell}` examples with pandas DataFrames.

## How to use it

Add the plugin to your `myst.yml`:

```yaml
project:
  plugins:
    - https://raw.githubusercontent.com/myst-contrib/myst-tabulator/main/src/tabulator.mjs
```

Add the directive once per page and it will enhance **all HTML tables in the content section of the page**:

````
:::{tabulator}
:::
````

## Scoping

To only enhance subsets of HTML tables, use `:selector-include:` / `:selector-exclude:` options.
In this case, multiple `{tabulator}` directives can coexist on one page; each table is enhanced once (first match wins).

```
:::{tabulator}
:selector-include: .my-data table
:::
```

## What gets enhanced

Every `<table>` inside `article.article` or `main` — MyST tables, `{table}` directives, `{list-table}` outputs, and the HTML tables that pandas emits in code-cell outputs.

::::{myst:demo}
:::{tabulator}
:selector-include: .ex-basic table
:header-filter:
:::

:::{div}
:class: ex-basic

| Package | Language | Description |
|---------|----------|-------------|
| pandas | Python | Data analysis and manipulation |
| NumPy | Python | Numerical computing |
| SciPy | Python | Scientific computing |
| Matplotlib | Python | Plotting |
| scikit-learn | Python | Machine learning |
| Polars | Rust/Python | Fast dataframes |
| Dask | Python | Parallel computing |
| Xarray | Python | Labeled N-d arrays |
:::
::::

## Pagination

Add `:pagination:` (and optionally `:page-size:`) for client-side pagination.

::::{myst:demo}
:::{tabulator}
:selector-include: .ex-paged table
:pagination:
:page-size: 5
:header-filter:
:::

:::{div}
:class: ex-paged

| Package | Language | Description |
|---------|----------|-------------|
| pandas | Python | Data analysis |
| NumPy | Python | Numerical computing |
| SciPy | Python | Scientific computing |
| Matplotlib | Python | Plotting |
| scikit-learn | Python | Machine learning |
| Polars | Rust/Python | Fast dataframes |
| Dask | Python | Parallel computing |
| seaborn | Python | Statistical visualization |
| Plotly | Python | Interactive plotting |
| Altair | Python | Grammar-of-graphics |
:::
::::

## Search

Add `:search:` to show a single search input above the table.
Typing filters rows by matching the query against every column (case-insensitive substring).
The current query is mirrored to the `?tablesearch=` URL parameter, so a filtered view can be shared by copying the URL.

`:header-filter:` serves a similar purpose, but is per-column and doesn't use the URL search parameter.

::::{myst:demo}
:::{tabulator}
:selector-include: .ex-search table
:search:
:header-filter:
:::

:::{div}
:class: ex-search

| Package | Language | Description |
|---------|----------|-------------|
| pandas | Python | Data analysis |
| NumPy | Python | Numerical computing |
| SciPy | Python | Scientific computing |
| Polars | Rust/Python | Fast dataframes |
| Dask | Python | Parallel computing |
| Plotly | Python | Interactive plotting |
:::
::::

## Copy to clipboard

Add `:copy:` to show a "Copy" button in the table footer.
It writes the currently visible rows (with headers, tab-separated) to the clipboard — paste-friendly for spreadsheets.
Tabulator's Ctrl+C shortcut works too when the table has focus.

::::{myst:demo}
:::{tabulator}
:selector-include: .ex-copy table
:search:
:copy:
:::

:::{div}
:class: ex-copy

| Package | Language | Description |
|---------|----------|-------------|
| pandas | Python | Data analysis |
| NumPy | Python | Numerical computing |
| SciPy | Python | Scientific computing |
| Polars | Rust/Python | Fast dataframes |
:::
::::

## Sorting

Click a column header to sort.
By default the plugin handles two cases that Tabulator's stock sorter doesn't:

- **Numbers with units** like `$3.50` or `12%` sort numerically rather than alphabetically.
- **Empty / null cells** always go to the bottom of the column regardless of direction (ascending or descending).

::::{myst:demo}
:::{tabulator}
:selector-include: .ex-currency table
:::

:::{div}
:class: ex-currency

| Product | Price | Tax |
|---------|-------|-----|
| Apples | $0.99 | 5% |
| Bread | $3.50 |  |
| Milk | $4.25 | 5% |
| Eggs | $5.99 | 12% |
| Cheese | $12.00 | 8% |
| Olive oil | $24.50 |  |
:::
::::

You can override the sorter through `:tabulator-options:` — for example `{"columnDefaults": {"sorter": "string"}}` for plain alphabetic sort, or `{"columnDefaults": {"sorter": "number"}}` to use Tabulator's built-in number sorter (handles commas but not currency or percent symbols).

## Summary statistics

Add `:summary: <stat>` to show a calculated row at the bottom of every column.
Supported values: `sum`, `avg`, `min`, `max`, `count`, `concat`.
The numeric stats (`sum`, `avg`, `min`, `max`) understand currency and percent formatting, so columns like `$3.50` and `12%` total up correctly; non-numeric columns render an empty cell.

::::{myst:demo}
:::{tabulator}
:selector-include: .ex-summary table
:summary: sum
:copy:
:::

:::{div}
:class: ex-summary

| Product | Price | Quantity |
|---------|-------|----------|
| Apples | $0.99 | 12 |
| Bread | $3.50 | 4 |
| Milk | $4.25 | 6 |
| Cheese | $12.00 | 2 |
:::
::::

## Raw Tabulator options

Pass any other Tabulator constructor option through `:tabulator-options:` as a one-line JSON string.

```
:::{tabulator}
:tabulator-options: {"movableColumns": true, "layout": "fitColumns"}
:::
```

## Option reference

| Option | Type | Effect |
|---|---|---|
| `:selector-include:` | CSS selector | Tables to enhance. Default: article-body tables. |
| `:selector-exclude:` | CSS selector | Tables to skip. |
| `:pagination:` | flag | Enable local pagination. |
| `:page-size: N` | number | Rows per page (with `:pagination:`). |
| `:header-filter:` | flag | Add a filter input under each column header. |
| `:search:` | flag | Show a single search input above the table; filters across all columns. Synced to `?tablesearch=`. |
| `:copy:` | flag | Show a "Copy" button in the table footer. |
| `:summary: <stat>` | string | Bottom-row calc per column: `sum`, `avg`, `min`, `max`, `count`, `concat`. |
| `:layout: <mode>` | string | Tabulator layout (`fitColumns`, `fitData`, `fitDataFill`, …). |
| `:no-sort:` | flag | Disable click-to-sort on headers. |
| `:tabulator-options:` | JSON string | Merged into the Tabulator constructor (last-write-wins). |
