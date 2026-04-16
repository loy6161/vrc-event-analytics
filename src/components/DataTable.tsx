import { useState, useCallback } from 'react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type PaginationState,
  type RowData,
} from '@tanstack/react-table'
import '../styles/DataTable.css'

export interface DataTableProps<T extends RowData> {
  data: T[]
  columns: ColumnDef<T, any>[]
  /** Placeholder text for the global search box. Omit to hide search. */
  globalFilterPlaceholder?: string
  /** Default page size (default 20) */
  defaultPageSize?: number
  /** Extra content rendered in the toolbar (e.g. tab switcher, export button) */
  toolbarLeft?: React.ReactNode
  toolbarRight?: React.ReactNode
  /** Shown when data is empty */
  emptyMessage?: string
  /** Callback when a row is clicked */
  onRowClick?: (row: T) => void
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export function DataTable<T extends RowData>({
  data,
  columns,
  globalFilterPlaceholder,
  defaultPageSize = 20,
  toolbarLeft,
  toolbarRight,
  emptyMessage = 'No data',
  onRowClick,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [globalFilter, setGlobalFilter] = useState('')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  })

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: (val) => {
      setGlobalFilter(val)
      // Reset to first page on filter change
      setPagination(prev => ({ ...prev, pageIndex: 0 }))
    },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: 'includesString',
  })

  const { rows } = table.getRowModel()
  const totalFiltered = table.getFilteredRowModel().rows.length
  const pageCount = table.getPageCount()
  const { pageIndex, pageSize } = pagination

  const handleGlobalFilterChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      table.setGlobalFilter(e.target.value)
    },
    [table],
  )

  return (
    <div className="data-table-wrapper">
      {/* Toolbar */}
      <div className="data-table-toolbar">
        <div className="toolbar-left">
          {toolbarLeft}
        </div>
        <div className="toolbar-right">
          {globalFilterPlaceholder !== undefined && (
            <input
              type="text"
              className="dt-search-input"
              placeholder={globalFilterPlaceholder || 'Search...'}
              value={globalFilter}
              onChange={handleGlobalFilterChange}
            />
          )}
          {toolbarRight}
        </div>
      </div>

      {/* Table */}
      <div className="data-table-scroll">
        <table className="data-table">
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  const isSortable = header.column.getCanSort()
                  const sortDir = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      className={[
                        isSortable ? 'sortable' : '',
                        sortDir ? `sorted-${sortDir}` : '',
                      ].filter(Boolean).join(' ')}
                      style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      onClick={isSortable ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="th-content">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {isSortable && (
                          <span className="sort-indicator" aria-hidden>
                            {sortDir === 'asc' ? ' ▲' : sortDir === 'desc' ? ' ▼' : ' ⇅'}
                          </span>
                        )}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="dt-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr
                  key={row.id}
                  className={onRowClick ? 'clickable' : ''}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: result count + pagination */}
      <div className="data-table-footer">
        <div className="dt-result-count">
          {totalFiltered === data.length
            ? `${data.length} rows`
            : `${totalFiltered} of ${data.length} rows`}
        </div>

        <div className="dt-pagination">
          <label className="dt-page-size-label">
            Rows per page:
            <select
              className="dt-page-size-select"
              value={pageSize}
              onChange={e => {
                table.setPageSize(Number(e.target.value))
                table.setPageIndex(0)
              }}
            >
              {PAGE_SIZE_OPTIONS.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>

          <span className="dt-page-info">
            Page {pageIndex + 1} / {pageCount || 1}
          </span>

          <div className="dt-page-buttons">
            <button
              className="dt-page-btn"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              title="First page"
            >«</button>
            <button
              className="dt-page-btn"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              title="Previous page"
            >‹</button>
            <button
              className="dt-page-btn"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              title="Next page"
            >›</button>
            <button
              className="dt-page-btn"
              onClick={() => table.setPageIndex(pageCount - 1)}
              disabled={!table.getCanNextPage()}
              title="Last page"
            >»</button>
          </div>
        </div>
      </div>
    </div>
  )
}
