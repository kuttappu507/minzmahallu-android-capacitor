/*
 * DataTable — modern, glass-style table with pagination + empty state.
 * On Android/narrow viewports each row renders as a Material-style card
 * (first column as the card title, remaining columns as label:value rows)
 * so nothing is squeezed into a horizontally-scrolling grid.
 */
import { Table, EmptyState, Pagination } from "@/components/ui";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";
import { useI18n } from "@/i18n";
import { motion } from "framer-motion";
import { useIsMobile } from "@/hooks/useIsMobile";

export interface Column<T> {
  header: string;
  accessor: (row: T) => React.ReactNode;
  width?: string;
  className?: string;
  align?: "left" | "right" | "center";
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  onPageChange?: (p: number) => void;
  searchValue?: string;
  onSearchChange?: (s: string) => void;
  searchPlaceholder?: string;
  toolbar?: React.ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  rowKey: (row: T, index: number) => string | number;
  onRowDoubleClick?: (row: T) => void;
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  total = 0,
  page = 1,
  pageSize = 20,
  totalPages = 1,
  onPageChange,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  toolbar,
  emptyTitle,
  emptyDescription,
  rowKey,
  onRowDoubleClick,
}: DataTableProps<T>) {
  const { t } = useI18n();
  const isMobile = useIsMobile();

  return (
    <div className="space-y-4">
      {(onSearchChange || toolbar) && (
        <div className={`flex items-center gap-3 ${isMobile ? "flex-col items-stretch" : "flex-wrap"}`}>
          {onSearchChange && (
            <div className={`relative group ${isMobile ? "w-full" : "shrink-0"}`}>
              <Search className="absolute left-3 top-1/2 z-10 -translate-y-1/2 h-4 w-4 text-text-tertiary transition-colors pointer-events-none group-focus-within:text-primary" aria-hidden="true" />
              <Input
                placeholder={searchPlaceholder || t("search_placeholder")}
                value={searchValue || ""}
                onChange={(e) => onSearchChange(e.target.value)}
                className="!pl-10 w-full m-search-inp"
                inputMode="search"
              />
            </div>
          )}
          {!isMobile && <div className="flex-1" />}
          {toolbar && <div className={isMobile ? "flex flex-wrap gap-2" : "flex items-center gap-3 flex-wrap"}>{toolbar}</div>}
        </div>
      )}

      {isMobile ? (
        <div className="m-table-wrap">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, ri) => (
                <div key={`skelc-${ri}`} className="m-card">
                  <div className="m-card-title"><span className="skel skel-line skel-line-md" /></div>
                  <div className="space-y-2 mt-2">
                    <span className="skel skel-line skel-line-lg" />
                    <span className="skel skel-line skel-line-sm" />
                  </div>
                </div>
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="card overflow-hidden">
              <EmptyState
                icon={<Search className="h-6 w-6" />}
                title={emptyTitle || t("ui_no_records")}
                description={emptyDescription || t("ui_click_add_to_create")}
              />
            </div>
          ) : (
            <div className="m-cards">
              {rows.map((row, i) => (
                <motion.div
                  key={rowKey(row, i)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(i * 0.015, 0.2) }}
                  className={`m-card ${onRowDoubleClick ? "m-card-tappable" : ""}`}
                  onClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                >
                  <div className="m-card-title">{columns[0]?.accessor(row)}</div>
                  {columns.slice(1).map((col, ci) => (
                    <div className="m-card-row" key={ci}>
                      <span className="k">{col.header}</span>
                      <span className={`v ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}>{col.accessor(row)}</span>
                    </div>
                  ))}
                </motion.div>
              ))}
            </div>
          )}
          {onPageChange && total > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages || 1}
              total={total}
              pageSize={pageSize}
              onPageChange={onPageChange}
            />
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <Table headers={columns.map((c) => c.header)}>
            {loading ? (
              // Skeleton shimmer rows — feels instant instead of "waiting on a spinner".
              // Render 8 rows of fake content sized to roughly match real rows.
              Array.from({ length: 8 }).map((_, ri) => (
                <tr key={`skel-${ri}`} className="skel-row">
                  {columns.map((col, ci) => {
                    // First column gets a circle (avatar-ish), others get lines of varying width.
                    if (ci === 0) return <td key={ci} className="px-4 py-3"><span className="skel skel-circle" /></td>;
                    const widths = ["skel-line-sm", "skel-line-md", "skel-line-lg"];
                    const w = widths[(ri + ci) % widths.length];
                    return <td key={ci} className="px-4 py-3"><span className={`skel skel-line ${w}`} /></td>;
                  })}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    icon={<Search className="h-6 w-6" />}
                    title={emptyTitle || t("ui_no_records")}
                    description={emptyDescription || t("ui_click_add_to_create")}
                  />
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <motion.tr
                  key={rowKey(row, i)}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.15, delay: Math.min(i * 0.02, 0.3) }}
                  className={`border-b border-border-subtle transition-colors hover:bg-surface-hover/50 ${onRowDoubleClick ? "row-clickable" : ""}`}
                  onDoubleClick={onRowDoubleClick ? () => onRowDoubleClick(row) : undefined}
                >
                  {columns.map((col, ci) => (
                    <td
                      key={ci}
                      className={`px-4 py-3 text-text-primary ${col.className || ""} ${col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""}`}
                    >
                      {col.accessor(row)}
                    </td>
                  ))}
                </motion.tr>
              ))
            )}
          </Table>

          {onPageChange && total > 0 && (
            <Pagination
              page={page}
              totalPages={totalPages || 1}
              total={total}
              pageSize={pageSize}
              onPageChange={onPageChange}
            />
          )}
        </div>
      )}
    </div>
  );
}
