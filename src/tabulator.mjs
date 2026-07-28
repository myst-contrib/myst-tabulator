/**
 * MyST plugin + anywidget for tabulator. Scans the article body and runs
 * Tabulator on each <table> in place — same light-DOM enhancement pattern
 * (and React-clobbering trade-off) as myst-lightbox and myst-searchfilter.
 */

// Dynamic import because this file is also evaluated in the browser, where
// `node:path` can't be resolved.
let pathMod;
try { pathMod = await import('node:path'); } catch {}
const PLUGIN_PATH = new URL(import.meta.url).pathname;

const TABULATOR_VERSION = '6.3.1';
const TABULATOR_ESM_URL = `https://cdn.jsdelivr.net/npm/tabulator-tables@${TABULATOR_VERSION}/+esm`;

// Stylesheets Tabulator ships in dist/css. "default" is the stock
// tabulator.min.css; every other name maps to tabulator_<name>.min.css.
const TABULATOR_THEMES = [
  'default', 'simple', 'midnight', 'modern', 'site', 'site_dark',
  'bootstrap3', 'bootstrap4', 'bootstrap5', 'bulma', 'materialize', 'semanticui',
];
function themeCssUrl(theme) {
  const file = theme === 'default' ? 'tabulator' : `tabulator_${theme || 'simple'}`;
  return `https://cdn.jsdelivr.net/npm/tabulator-tables@${TABULATOR_VERSION}/dist/css/${file}.min.css`;
}

// Default scope: article content only, so theme chrome isn't enhanced.
const DEFAULT_INCLUDE = 'article.article table, main table';

// Normalize a <table> for Tabulator's HTML import:
//   1. Ensure a <thead> exists (MyST puts everything in <tbody>).
//   2. Collapse multi-row <thead> to the last row (pandas MultiIndex
//      headers use colspan/rowspan that Tabulator can't parse — without
//      this you get phantom columns).
//   3. Convert <th> cells in <tbody> to <td>. Pandas uses <th> for the
//      row-index column (describe(), groupby); Tabulator treats those
//      as extra header columns, which drops data and adds phantoms.
function normalizeTable(table) {
  if (!table.tHead) {
    const firstRow = table.querySelector('tr');
    if (firstRow) {
      const thead = document.createElement('thead');
      thead.appendChild(firstRow);
      table.insertBefore(thead, table.firstChild);
    }
  }
  if (table.tHead) {
    while (table.tHead.rows.length > 1) table.tHead.deleteRow(0);
  }
  for (const tbody of table.tBodies) {
    for (const row of tbody.rows) {
      for (let i = row.cells.length - 1; i >= 0; i--) {
        const cell = row.cells[i];
        if (cell.tagName === 'TH') {
          const td = document.createElement('td');
          td.innerHTML = cell.innerHTML;
          for (const attr of cell.attributes) td.setAttribute(attr.name, attr.value);
          row.replaceChild(td, cell);
        }
      }
    }
  }
}

// Tolerant number parser: returns null if the value isn't number-like.
// Strips a leading currency symbol, trailing percent, and thousand-separator
// commas. Then requires the result to match a real number literal
// so we don't convert dates etc.
function asNumber(v) {
  if (v == null) return null;
  const cleaned = String(v)
    .trim()
    .replace(/^([-+]?)[$£€¥₹]/, '$1')
    .replace(/%$/, '')
    .replace(/,/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(cleaned)) return null;
  return parseFloat(cleaned);
}

// Numeric reducers for :summary: option. Tabulator's built-in sum/avg/min/max
// only handle raw numbers; these go through asNumber() so currency- and
// percent-formatted columns total up correctly. `count` and `concat` fall
// back to Tabulator's stock implementations (they work on any data).
const SUMMARY_REDUCERS = {
  sum: ns => ns.reduce((a, b) => a + b, 0),
  avg: ns => ns.reduce((a, b) => a + b, 0) / ns.length,
  min: ns => Math.min(...ns),
  max: ns => Math.max(...ns),
};
function summaryCalc(kind) {
  if (kind === 'count' || kind === 'concat') return kind;
  const reducer = SUMMARY_REDUCERS[kind];
  if (!reducer) return null;
  return values => {
    const nums = values.map(asNumber).filter(n => n !== null);
    return nums.length ? Math.round(reducer(nums) * 100) / 100 : '';
  };
}

// Tracks tables we've already handed to Tabulator. Module-scoped (rather
// than per-render) so that repeated render() calls — from hot reload,
// route remounts, anywidget re-renders — don't re-enhance the same DOM
// elements and stack up duplicate Copy buttons.
const enhanced = new WeakSet();

// Default sorter: numeric if both values parse as numbers (so `$3.50`
// and `12%` sort the way readers expect). Empty/null cells are always
// pushed to the bottom regardless of sort direction.
function smartSort(a, b, aRow, bRow, column, dir) {
  const aEmpty = a == null || String(a).trim() === '';
  const bEmpty = b == null || String(b).trim() === '';
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return dir === 'desc' ? -1 : 1;
  if (bEmpty) return dir === 'desc' ? 1 : -1;

  const nA = asNumber(a);
  const nB = asNumber(b);
  if (nA !== null && nB !== null) return nA - nB;
  if (nA !== null) return -1;
  if (nB !== null) return 1;
  return String(a).localeCompare(String(b));
}

// Plugin-injected styles: fixes for the myst-theme's tailwind resets,
// our toolbar, and dark-mode overrides for Tabulator's light-only CSS.
const PLUGIN_CSS = `
  /* Header-filter inputs lose their borders/background under Tailwind resets. */
  .tabulator .tabulator-header-filter input,
  .tabulator .tabulator-header-filter select {
    border: 1px solid #aaa;
    border-radius: 3px;
    padding: 2px 4px;
    background: #fff;
    color: #111;
    width: 100%;
    box-sizing: border-box;
  }
  /* Tabulator marks calc rows (summary totals) as non-selectable; re-enable
     so readers can highlight/copy the totals like any other cell. */
  .tabulator-row.tabulator-calcs {
    user-select: text;
  }
  /* Single right-aligned toolbar above the table; holds search input and/or
     Copy button so they share one row instead of stacking. */
  .myst-tab-toolbar {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.4rem;
    margin: 0 0 0.4rem;
  }
  /* Shared visuals for the search input and Copy button — same reset reason
     as the header-filter rule above. */
  .myst-tab-search,
  .myst-tab-copy {
    font-size: 0.85rem;
    border: 1px solid #aaa;
    border-radius: 4px;
    background: #fff;
    color: #111;
  }
  /* Slightly tighter horizontal padding for the input vs. the button. */
  .myst-tab-search { padding: 0.3rem 0.5rem; }
  /* Wider padding + pointer cursor to read as a clickable button. */
  .myst-tab-copy { padding: 0.3rem 0.7rem; cursor: pointer; }

  /* Dark mode: the site theme toggles a "dark" class on <html>, but
     Tabulator's stock themes are light-only. Rather than restyling every
     theme's surfaces, invert them wholesale — hue-rotate keeps accent
     colors close to their light-mode hues. Natively dark themes opt out
     via the data-tabulator-dark-theme attribute set in render(). Images
     inside cells are counter-inverted back to normal. */
  html.dark:not([data-tabulator-dark-theme]) .tabulator,
  html.dark:not([data-tabulator-dark-theme]) .myst-tab-toolbar {
    filter: invert(1) hue-rotate(180deg);
  }
  /* Normalize colors before inverting: themes that inherit text color from
     the page would otherwise pick up the site's light-on-dark text and end
     up dark-on-dark after the inversion. */
  html.dark:not([data-tabulator-dark-theme]) .tabulator {
    color: #111;
    background: #fff;
  }
  html.dark:not([data-tabulator-dark-theme]) .tabulator img {
    filter: invert(1) hue-rotate(180deg);
  }
`;

async function render({ model, el }) {
  el.style.display = 'none';

  const include = (model.get('include') || '').trim() || DEFAULT_INCLUDE;
  const exclude = (model.get('exclude') || '').trim();
  const userOptions = model.get('options') || {};
  const searchEnabled = !!model.get('search');

  // Default columnDefaults:
  //   - formatter:'html' so MyST-rendered <code>/<strong>/etc. display correctly.
  //   - sorter:smartSort handles both numeric-with-units and the empty-at-bottom rule.
  //   - bottomCalc applied per-column when :summary: is set.
  const summary = (model.get('summary') || '').trim();
  const bottomCalc = summary ? summaryCalc(summary) : null;
  const options = {
    ...userOptions,
    columnDefaults: {
      formatter: 'html',
      sorter: smartSort,
      ...(bottomCalc ? { bottomCalc } : {}),
      ...(userOptions.columnDefaults || {}),
    },
  };

  // Tabulator runs on light-DOM tables, so the stylesheet has to live in
  // document.head — the anywidget's shadow CSS doesn't reach them.
  // One theme stylesheet for the whole document. Always sync its href: the
  // MyST site is a SPA, so navigating between pages re-renders widgets without
  // a full reload, and the link must follow the current page's :theme:.
  const themeName = (model.get('theme') || '').trim();
  let themeLink = document.querySelector('link[data-myst-tabulator]');
  if (!themeLink) {
    themeLink = document.createElement('link');
    themeLink.rel = 'stylesheet';
    themeLink.dataset.mystTabulator = '1';
    document.head.appendChild(themeLink);
  }
  // Flag natively dark themes so the dark-mode invert filter skips them.
  document.documentElement.toggleAttribute(
    'data-tabulator-dark-theme', ['midnight', 'site_dark'].includes(themeName));
  const themeUrl = themeCssUrl(themeName);
  if (themeLink.href !== themeUrl) {
    // Wait for the CSS before building tables: Tabulator measures rows and
    // columns at construction time, and measuring against unstyled content
    // bakes in a broken layout until the next full reload.
    await new Promise((resolve) => {
      themeLink.addEventListener('load', resolve, { once: true });
      themeLink.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 2000);
      themeLink.href = themeUrl;
    });
  }
  if (!document.querySelector('style[data-myst-tabulator]')) {
    const style = document.createElement('style');
    style.dataset.mystTabulator = '1';
    style.textContent = PLUGIN_CSS;
    document.head.appendChild(style);
  }

  // Tabulator destroys the original <table> element when it enhances it,
  // so a dataset marker doesn't survive. Track enhanced elements in a
  // module-scoped WeakSet (declared at the top of the file) so duplicate
  // render() calls don't re-enhance the same table.
  let mod;

  // Find every matching <table>, hand it to Tabulator, and attach our chrome
  // (toolbar with search/copy). Safe to call repeatedly — the WeakSet skips
  // tables we've already enhanced.
  function enhanceMatching() {
    if (!mod) return;
    const tables = document.querySelectorAll(include);
    const excluded = exclude ? new Set(document.querySelectorAll(exclude)) : null;
    for (const table of tables) {
      if (excluded?.has(table)) continue;
      if (enhanced.has(table)) continue;
      enhanced.add(table);
      try {
        normalizeTable(table);
        const t = new mod.TabulatorFull(table, options);

        // Right-aligned toolbar above the wrapper holds search input and/or
        // Copy button. `hasToolbar` guards against re-attaching after
        // something has already been attached so they don't stack.
        const hasToolbar = t.element.previousElementSibling?.classList.contains('myst-tab-toolbar');
        if ((searchEnabled || options.clipboard === 'copy') && !hasToolbar) {
          const toolbar = document.createElement('div');
          toolbar.className = 'myst-tab-toolbar';

          if (searchEnabled) {
            // Omni-search: case-insensitive substring match across every
            // column. Query is mirrored to ?tablesearch= so a filtered view
            // can be shared by copying the URL, and seeded from it on load.
            const input = document.createElement('input');
            input.type = 'search';
            input.className = 'myst-tab-search';
            input.placeholder = 'Search…';
            const apply = q => {
              if (!q) return t.clearFilter();
              const needle = q.toLowerCase();
              t.setFilter(row => t.getColumns().some(col => {
                const field = col.getField();
                if (!field) return false;
                const v = row[field];
                return v != null && String(v).toLowerCase().includes(needle);
              }));
            };
            // Filters + updates the search parameter as you type
            input.addEventListener('input', () => {
              const q = input.value.trim();
              apply(q);
              const url = new URL(window.location.href);
              if (q) url.searchParams.set('tablesearch', q);
              else url.searchParams.delete('tablesearch');
              history.replaceState(null, '', url);
            });
            const initial = new URLSearchParams(window.location.search).get('tablesearch') ?? '';
            if (initial) {
              input.value = initial;
              apply(initial);
            }
            toolbar.appendChild(input);
          }

          if (options.clipboard === 'copy') {
            // Copy button: writes the currently-visible rows to the clipboard
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'myst-tab-copy';
            btn.textContent = 'Copy';
            let resetTimer;
            btn.addEventListener('click', async () => {
              clearTimeout(resetTimer);
              try {
                await t.copyToClipboard();
                btn.textContent = 'Copied!';
              } catch {
                btn.textContent = 'Copy failed';
              }
              resetTimer = setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
            });
            toolbar.appendChild(btn);
          }

          t.element.insertAdjacentElement('beforebegin', toolbar);
        }
      } catch (err) {
        console.warn('myst-tabulator: failed to enhance', table, err);
      }
    }
  }

  // Catch tables added after our initial pass (thebe attaches code-cell
  // outputs asynchronously). MutationObserver is the fast path; the
  // timed retries are a belt-and-suspenders for cases where the observer
  // misses the addition (e.g. shadow-DOM-scoped mutations).
  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; enhanceMatching(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });

  try {
    mod = await import(TABULATOR_ESM_URL);
  } catch (err) {
    console.warn('myst-tabulator: failed to load Tabulator', err);
    return;
  }
  enhanceMatching();
  for (const delay of [500, 1500, 4000]) setTimeout(enhanceMatching, delay);
}

const tabulatorDirective = {
  name: 'tabulator',
  doc: 'Enhance every <table> in the article body with Tabulator. Scope with :selector-include: / :selector-exclude:.',
  options: {
    'selector-include': {
      type: String,
      doc: `CSS selector for tables to enhance. Default: ${DEFAULT_INCLUDE}`,
    },
    'selector-exclude': {
      type: String,
      doc: 'CSS selector for tables to skip.',
    },
    pagination: { type: Boolean, doc: 'Enable local pagination.' },
    'page-size': { type: Number, doc: 'Rows per page when pagination is enabled.' },
    'header-filter': { type: Boolean, doc: 'Add a filter input under each column header.' },
    search: { type: Boolean, doc: 'Show a single search input above the table that filters rows across every column. Synced to/from the ?tablesearch= URL parameter.' },
    copy: { type: Boolean, doc: 'Show a "Copy" button above the table that copies the visible rows to the clipboard.' },
    summary: { type: String, doc: 'Show a bottom row with a calculated value per column. One of: sum, avg, min, max, count, concat.' },
    theme: { type: String, doc: `Tabulator stylesheet for the whole page (one theme per page). One of: ${TABULATOR_THEMES.join(', ')}. Default: simple.` },
    layout: { type: String, doc: 'Tabulator layout mode (e.g. fitColumns, fitData, fitDataFill).' },
    'no-sort': { type: Boolean, doc: 'Disable click-to-sort on column headers.' },
    'tabulator-options': {
      type: String,
      doc: 'Raw JSON merged into the Tabulator constructor options (last-write-wins).',
    },
  },
  run(data, vfile) {
    const opts = data.options ?? {};

    let extra;
    const raw = opts['tabulator-options'];
    if (raw && raw.trim()) {
      try {
        extra = JSON.parse(raw);
      } catch (err) {
        vfile.message(
          `tabulator: could not parse :tabulator-options: as JSON - ${err.message}`,
        );
      }
    }

    const tabulatorOpts = {};
    const colDefaults = {};
    if (opts.pagination) tabulatorOpts.pagination = 'local';
    if (typeof opts['page-size'] === 'number') tabulatorOpts.paginationSize = opts['page-size'];
    if (opts['header-filter']) colDefaults.headerFilter = 'input';
    if (opts['no-sort']) colDefaults.headerSort = false;
    if (opts.layout) tabulatorOpts.layout = opts.layout;
    if (opts.copy) {
      tabulatorOpts.clipboard = 'copy';
      tabulatorOpts.clipboardCopyRowRange = 'active';
      // Explicit copy config: include headers, exclude everything synthetic
      // (calc rows, groups, tree summaries) so :summary: totals don't leak
      // into the clipboard alongside the data rows.
      tabulatorOpts.clipboardCopyConfig = {
        columnHeaders: true,
        columnGroups: false,
        rowGroups: false,
        columnCalcs: false,
        dataTree: false,
      };
    }
    if (Object.keys(colDefaults).length > 0) tabulatorOpts.columnDefaults = colDefaults;
    if (extra) Object.assign(tabulatorOpts, extra);

    const allowedSummary = ['sum', 'avg', 'min', 'max', 'count', 'concat'];
    if (opts.summary && !allowedSummary.includes(opts.summary)) {
      vfile.message(
        `tabulator: :summary: must be one of ${allowedSummary.join('|')}, got "${opts.summary}"`,
      );
    }
    if (opts.theme && !TABULATOR_THEMES.includes(opts.theme)) {
      vfile.message(
        `tabulator: :theme: must be one of ${TABULATOR_THEMES.join('|')}, got "${opts.theme}"`,
      );
    }

    return [{
      type: 'anywidget',
      esm: pathMod.relative(pathMod.dirname(vfile.path), PLUGIN_PATH),
      model: {
        include: opts['selector-include'] ?? '',
        exclude: opts['selector-exclude'] ?? '',
        options: tabulatorOpts,
        summary: opts.summary ?? '',
        theme: opts.theme ?? '',
        search: !!opts.search,
      },
      id: crypto.randomUUID(),
    }];
  },
};

export default {
  name: 'tabulator',
  directives: [tabulatorDirective],
  render,
};
