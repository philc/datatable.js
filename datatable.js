/*
 * A DataTable is a sortable HTML table which displays an array of rows. Each column in the table
 * can have a formatting function.
 * Rows are of the form: { col1: val1, col2: val2 }.
 * This is a simpler, tailored implementation of the UX provided by https://datatables.net
 */

const isValidNumber = (v) => v != null && isFinite(v);

// It's expensive to create a new locale object every time we format a number. MDN docs suggest
// caching them.
const cachedLocales = [];
const createLocale = (precision) =>
  Intl.NumberFormat("en-US", {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
  });

// TODO(philc): Move these formatters into one object called "Formatters".
const formatCurrency = (v, _, precision) => {
  if (!isValidNumber(v)) return "-";
  if (precision == null) precision = 2;
  if (!cachedLocales[precision]) {
    cachedLocales[precision] = createLocale(precision);
  }
  return "$" + cachedLocales[precision].format(v);
};

const formatDollars = (v) => formatCurrency(v, null, 0);
const formatCPM = (v) => formatCurrency(v && v / 1000);
const formatPercent = (v, _, precision = 2) => {
  if (!isValidNumber(v)) return "-";
  if (!cachedLocales[precision]) {
    cachedLocales[precision] = createLocale(precision);
  }
  return cachedLocales[precision].format(v * 100) + "%";
};
const formatPercent0 = (v) => formatPercent(v, null, 0);
const formatPercent1 = (v) => formatPercent(v, null, 1);

const formatFixed = (v, _, precision) => {
  if (!isValidNumber(v)) return "-";
  if (!cachedLocales[precision]) {
    cachedLocales[precision] = createLocale(precision);
  }
  return cachedLocales[precision].format(v);
};
const formatFixed0 = (v) => formatFixed(v, null, 0);
const formatFixed1 = (v) => formatFixed(v, null, 1);
const formatFixed2 = (v) => formatFixed(v, null, 2);

// Format in thousands, e.g. 3.2K.
const formatThousands = (v, row) => formatFixed(v / 1000.0, row, 1) + "K";

// Format an ML calibration metric, e.g. 1.02x.
const formatCalibration = (v) => isValidNumber(v) ? v.toFixed(2) + "x" : "-";

// Truncates the string if its length is > s and appends an ellipsis character.
const truncate = (s, length) => s.length <= length ? s : s.substring(s, length - 1) + "…";

class DataTable extends EventTarget {
  // options:
  // - sort: map of { column: order }. `order` can be either "asc" or "desc".
  // - formatters: a map of { column: formatterFn }, where formatterFn takes args [cellValue, row].
  // - columns: a subset of columns to render from the rows passed to `renderMaps`. If null, the
  //   columns will be detected from the keys of the first row passed to `renderMaps`.
  // - columnNames: a map of { column: display name } for the columns provided in `columns`.
  // - clickableColumns: the names of columns which should be styled to indicate that they're
  //   clickable.
  constructor(options) {
    super();
    this.columnNames = options.columnNames || [];
    this.columns = options.columns;
    this.pageSize = options.pageSize || 30;
    this.sortOptions = options.sort;
    this.clickableColumns = options.clickableColumns || [];
    this.el = document.createElement("table");
    this.el.classList.add("datatable");
    this.el.innerHTML = "<thead /><tbody />";
    this.formatters = options.formatters || {};
    this.el.addEventListener("click", (e) => this.onClick(e));
  }

  onClick(event) {
    if (event.target.tagName == "TD") {
      const td = event.target;
      const tr = td.parentNode;
      const column = this.renderedColumns[td.cellIndex];
      const action = event.shiftKey ? "toggle" : "select";
      this.dispatchEvent(
        new CustomEvent("cellClick", {
          detail: {
            column: column,
            value: this.rows[parseInt(tr.dataset.i)][column],
            action: action,
          },
        }),
      );
      // Because we're using shift, text gets highlighted, which is unintentional and distracting.
      // TODO(philc): Remove this use of shift, and instead use explicit checkboxes.
      window.getSelection().removeAllRanges();
    } else if (event.target.classList.contains("graph-button")) {
      this.dispatchEvent(new Event("graphButtonClick"));
    } else if (event.target.tagName == "TH") {
      // Change the sort order.
      const th = event.target;
      const column = this.renderedColumns[th.cellIndex];
      let sortOptions;
      if (this.sortOptions?.column == column) {
        sortOptions = {
          column: column,
          order: this.sortOptions.order == "asc" ? "desc" : "asc",
        };
      } else {
        // Here, the default order when clicking on a new column is "desc", because it's normally
        // more conveient to see the head of the distribution as the first/top rows.
        sortOptions = { column: column, order: "desc" };
      }
      this.setSortOptions(sortOptions);
      this.dispatchEvent(new CustomEvent("sortChange", { detail: { sort: this.sortOptions } }));
    }
  }

  setSortOptions(sortOptions) {
    if (JSON.stringify(this.sortOptions) === JSON.stringify(sortOptions)) {
      return;
    }
    this.sortOptions = sortOptions;
  }

  // Render the given rows.
  // - isSelectedFn: optional. Takes a row as an argument, and returns true if that row should be
  //   shown as "selected".
  renderRows(rows, isSelectedFn) {
    // Store `rows` so that we can retrieve the typed (non-formatted) value when a TD is clicked.
    this.rows = rows;

    const tbody = this.el.querySelector("tbody");
    if (!this.rows[0]) {
      tbody.innerHTML = "";
      return;
    }

    // Sort the rows if necessary.
    if (this.sortOptions) {
      const compare = (a, b) => {
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
      };
      const column = this.sortOptions.column;
      const comparator = this.sortOptions.order == "asc"
        ? (a, b) => compare(a[column], b[column])
        : (a, b) => compare(b[column], a[column]);
      this.rows.sort(comparator);
    }

    const columns = this.columns || Object.keys(this.rows[0]);
    this.renderedColumns = columns;
    const html = [];
    const format = (col, row) => {
      return this.formatters[col] ? this.formatters[col](row[col], row) : "" + row[col];
    };

    // Use a heuristic to determine the type of each row, which determines its text alignment. We're
    // using this heuristic on the rendered string, rather than the underlying value, because a
    // common pattern is to replace a numeric ID value with a string name representing that ID (e.g.
    // customer ID -> customer name), so the column should then be treated as string for display
    // purposes, not a number.
    const isNumeric = (string) => /^[$]*[0-9,.\-]+[%xKMG]*$/.test(string);
    const row = this.rows[0];
    const colStyles = columns.map((c) => {
      const classNames = [
        this.clickableColumns.includes(c) ? "clickable" : null,
        isNumeric(format(c, row)) ? "number" : null,
      ].filter((s) => s != null);
      return classNames.length == 0 ? null : classNames.join(",");
    });

    this.el.querySelector("thead").innerHTML = columns
      .map((col, i) => {
        const columnName = this.columnNames[col] || DataTable.formatColumnName(col);
        const klass = colStyles[i] ? `class='${colStyles[i]}'` : "";
        // TODO(philc): Make this graph button into an option; dashboards without graphs shouldn't
        // show this.
        // This graph button is used to plot a set of dimension values onto a graph. Show it only in
        // the left-most <th>.
        // const graphButton = (i == 0) ? "<a class='graph-button fas fa-chart-line'></a>" : "";
        const graphButton = "";
        // The span inside the <th> is used for styling.
        return `<th ${klass} data-column='${col}'>${graphButton}<span>${columnName}</span></th>`;
      })
      .join("\n");

    if (this.sortOptions) {
      // It's possible that the column we're sorting with is not present in `columns`.
      const sortColumnIndex = columns.indexOf(this.sortOptions.column);
      if (sortColumnIndex >= 0) {
        const th = this.el.querySelectorAll("th")[sortColumnIndex];
        th.classList.add(this.sortOptions.order);
      }
    }

    // TODO(philc): Here, we're truncating all rows after `this.pageSize`. Instead, implement
    // pagination.
    const rowCount = Math.min(rows.length, this.pageSize);
    for (let i = 0; i < rowCount; i++) {
      const row = rows[i];
      const rowClass = isSelectedFn
        ? `class="${isSelectedFn(row) ? "selected" : "unselected"}"`
        : null;
      html.push(`<tr data-i='${i}' ${rowClass}>`);
      // TODO(philc): Santize value by escaping double quotes.
      html.push(
        columns.map((col, j) => {
          // We pass in the entire row in case the formatter needs additional context to format.
          const value = format(col, row);
          const klass = colStyles[j] ? `class='${colStyles[j]}'` : "";
          return `<td ${klass} data-column='${col}'>${value}</td>`;
        }),
      );
      html.push("</tr>");
    }
    tbody.innerHTML = html.flat().join("");
  }

  // Formats a column name into something more human readable and terse. It's used as the default
  // formatter of column names when a specific name isn't provided in the `columnNames` option to the
  // DataTable constructor. E.g. "pct-qps" => "% QPS".
  static formatColumnName(column) {
    // Ensure columns like "user-id" convert to "User ID".
    column = column.replace(/-id$/, "-ID");
    // Convert "percent" to "%"
    column = column.replace(/percent/, "%");
    column = column.replace(/pct/, "%");
    // Convert "delta" to "Δ"
    column = column.replace(/delta/, "Δ");
    const words = column.split("-").map((w) => w[0].toUpperCase() + w.slice(1));
    return words.join(" ");
  }
}

// Adds metrics to the given set of `rows`, modifying each object in `rows`.
// - rows: a collection of objects.
// - metricToFn: a map of metricName => function, where the function takes the row as an argument,
//   and returns the value of that metric.
// Sample usage:
//   addMetrics(rows, { "cpc": (row) => row.spend / row.clicks })
// TODO(philc): Make this a static member of DataTable.js
function addMetrics(rows, metricToFn) {
  const m = new Map(Object.entries(metricToFn));
  for (row of rows) for ([metric, fn] of m) row[metric] = fn(row);
}

/*
 * Removes each property in `columns` from each object in `rows`, modifying each row object.
 */
function removeColumns(rows, columns) {
  for (const row of rows) {
    for (const col of columns) {
      delete row[col];
    }
  }
}

export { DataTable };
