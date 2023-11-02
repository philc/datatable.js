# Datatable.js - a minimal HTML data table for presenting tabular data

A data table is a sortable HTML table which displays tabular data.

This is a simpler, tailored implementation of the UX provided by
[datatables.net](https://datatables.net), and is primarily used for building interactive dashboards.

## Example usage


```javascript
import * as dt from "./datatable.js";

// Row data will typically come from a database. These row objects should be in the form:
// { col1: val1, col2: val2 }.
const rows = [];
for (let i = 1; i <= 10; i++) {
  rows.push({ name: "Sample product " + i, views: i* 10, purchases: i, revenue: i * 9.99 });
}

const table = new dt.DataTable({
  columnNames: { id: "ID" },
  sort: { column: "views", order: "asc" },
  formatters: { revenue: dt.formatters.currency }
});

table.renderRows(rows);
document.body.appendChild(table.el);

// Optional events.
table.addEventListener("cellClick", (event) => ...);
table.addEventListener("sortChange", (event) => ...);
```

## License

Licensed under the [MIT license](LICENSE.txt).
