/*
 * CRUD list hook — abstracts away pagination, search, fetch logic.
 *
 * CRITICAL: listFn must be stored in a ref, NOT in the useCallback deps.
 */
import { useEffect, useState, useCallback, useRef } from "react";

type ListFn = (filter: any) => Promise<{ rows: any[]; total: number }>;

export function useList(
  listFn: ListFn,
  opts: { pageSize?: number; initialSearch?: string; initialFilters?: any } = {}
) {
  const { pageSize = 20, initialSearch = "", initialFilters = {} } = opts;
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(initialSearch);
  const [filters, setFilters] = useState(initialFilters);
  const [loading, setLoading] = useState(false);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const listFnRef = useRef(listFn); listFnRef.current = listFn;
  const searchRef = useRef(search); searchRef.current = search;
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const pageRef = useRef(page); pageRef.current = page;
  const [fetchVersion, setFetchVersion] = useState(0);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const filter: any = { search: searchRef.current || undefined, page: pageRef.current, pageSize, ...filtersRef.current };
      // "All" is a UI sentinel, not a family id. Passing it to SQLite makes
      // the Members query filter on m.family_id = 'All' and returns no rows.
      if (filter.familyId === "All") delete filter.familyId;
      const result = await listFnRef.current(filter);
      setRows(result.rows || []); setTotal(result.total || 0);
    } catch (err) { console.error("List fetch failed:", err); }
    finally { setLoading(false); }
  }, [pageSize, fetchVersion]);

  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { refetch(); }, [refetch, page, debouncedSearch, filters]);
  useEffect(() => { if (page !== 1) setPage(1); }, [debouncedSearch]);
  const manualRefetch = useCallback(() => setFetchVersion(v => v + 1), []);

  return { rows, total, page, totalPages, pageSize, loading, search, setSearch, setPage, setFilters, refetch: manualRefetch };
}

export function useAsync<T>(
  fn: () => Promise<T>, deps: any[] = []
): { data: T | null; loading: boolean; error: string | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn); fnRef.current = fn;
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try { setData(await fnRef.current()); }
    catch (err: any) { setError(err.message || "Failed to load"); }
    finally { setLoading(false); }
  }, deps);
  useEffect(() => { refresh(); }, [refresh]);
  return { data, loading, error, refresh };
}
