# myst-tabulator

Turn every table on a MyST page into an interactive [Tabulator](https://tabulator.info) widget with one directive.

## Install

Add to your `myst.yml`:

```yaml
project:
  plugins:
    - https://raw.githubusercontent.com/myst-contrib/myst-tabulator/main/src/tabulator.mjs
```

## Usage

Put the directive once per page:

````
:::{tabulator}
:header-filter:
:::
````

Every `<table>` in the article body is auto-enhanced, including pandas DataFrame outputs from `{code-cell}` directives.

See [`docs/index.md`](./docs/index.md) for the full option list and live demos.

## Local development

```sh
nox -s docs-live   # live server
nox -s docs        # static build
```

## Limitations

- Tabulator can't parse tables with multi-row headers, `colspan`, or `rowspan`.
