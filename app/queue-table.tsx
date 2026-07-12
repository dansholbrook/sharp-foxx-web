'use client';

// Shared queue primitives used by the staff review pages (/applicants, /review,
// /nil-review): a compact branded table whose rows open a right-side slide-over
// detail panel. Both are presentation-only -- every page keeps its own data
// loading and API actions and just plugs them into these shells so the three
// queues read and behave identically.

import {
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

// ---- SlideOver -----------------------------------------------------------
// A right-side panel that slides over a dim backdrop. Mounting it means it's
// open; the parent unmounts it to close. Esc, a backdrop click, or the X all
// call onClose (the parent handles returning focus to the row). Reuses the
// modal styling tokens; scoped via .slideover-*.
export function SlideOver({
  onClose,
  kicker,
  title,
  children,
  footer,
  label,
}: {
  onClose: () => void;
  kicker?: ReactNode;
  title: ReactNode;
  children: ReactNode; // scrollable body
  footer?: ReactNode; // sticky footer (action buttons)
  label?: string; // aria-label for the dialog
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Esc closes from anywhere while open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Lock the page behind the panel from scrolling while it's open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Move focus into the panel on open so keyboard users land inside it.
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className="slideover-backdrop" onClick={onClose}>
      <div
        ref={panelRef}
        className="slideover-panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="slideover-head">
          <div>
            {kicker && <span className="game-kicker">{kicker}</span>}
            <h2 className="slideover-title">{title}</h2>
          </div>
          <button
            type="button"
            className="link-btn slideover-close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="slideover-body">{children}</div>

        {footer && <div className="slideover-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ---- QueueTable ----------------------------------------------------------
// A compact table: one row per item, click (or Enter/Space on a focused row)
// either opens the slide-over rendered by renderDetail (the default) or, when
// onRowActivate is given, navigates instead -- used by pages that already have
// a full detail route (My Games' workspace, the rep drill-down) so a row reads
// as a link rather than a dialog trigger. Built-in client-side pagination shows
// `pageSize` rows and appends `pageSize` more on "Show more" (the queue APIs
// return full lists today; if a queue ever grows past a few hundred rows this
// should move to server pagination).

export interface Column<T> {
  key: string;
  header: string;
  cell: (item: T) => ReactNode;
  // Right-align + tabular-nums for numeric columns (adds the shared .num class).
  align?: 'right';
}

export function QueueTable<T>({
  columns,
  rows,
  rowKey,
  renderDetail,
  onRowActivate,
  pageSize = 15,
  resetKey,
  ariaLabel,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (item: T) => string;
  // Slide-over mode (the default): returns a <SlideOver> for the selected row;
  // `close` closes it (and returns focus to the row). Action handlers live in
  // here, in the calling page. Optional -- omit it when using navigation mode.
  renderDetail?: (item: T, close: () => void) => ReactNode;
  // Navigation mode: given, a row click (or Enter/Space) calls this instead of
  // opening a slide-over, and rows render as links. Use for pages that already
  // have a full detail route to send the row to.
  onRowActivate?: (item: T) => void;
  pageSize?: number;
  // Change this (e.g. the active status filter) to re-page back to the first
  // page; leave undefined for a single unfiltered list.
  resetKey?: unknown;
  ariaLabel?: string;
}) {
  const [visible, setVisible] = useState(pageSize);
  const [selected, setSelected] = useState<T | null>(null);
  // The <tr> for each rendered row, so focus can return to it on close.
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  // The row that opened the current slide-over (for focus return).
  const activeKey = useRef<string | null>(null);

  // Re-page to the first page whenever the filter (resetKey) changes.
  useEffect(() => {
    setVisible(pageSize);
  }, [resetKey, pageSize]);

  const open = useCallback((item: T, key: string) => {
    activeKey.current = key;
    setSelected(item);
  }, []);

  const close = useCallback(() => {
    const key = activeKey.current;
    setSelected(null);
    activeKey.current = null;
    // Return focus to the row that opened the panel, once it's back in the DOM.
    if (key) {
      requestAnimationFrame(() => rowRefs.current.get(key)?.focus());
    }
  }, []);

  const shown = rows.slice(0, visible);
  const selectedKey = selected ? rowKey(selected) : null;

  return (
    <>
      <div className="queue-table-wrap">
        <table className="queue-table" aria-label={ariaLabel}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => {
              const key = rowKey(item);
              // Navigation mode routes away; slide-over mode opens the panel.
              const activate = onRowActivate
                ? () => onRowActivate(item)
                : () => open(item, key);
              return (
                <tr
                  key={key}
                  ref={(el) => {
                    if (el) rowRefs.current.set(key, el);
                    else rowRefs.current.delete(key);
                  }}
                  tabIndex={0}
                  role={onRowActivate ? 'link' : 'button'}
                  aria-haspopup={onRowActivate ? undefined : 'dialog'}
                  className={
                    selectedKey === key ? 'queue-row queue-row--on' : 'queue-row'
                  }
                  onClick={activate}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      activate();
                    }
                  }}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? 'num' : undefined}>
                      {c.cell(item)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {rows.length > visible && (
        <div className="queue-more">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setVisible((v) => v + pageSize)}
          >
            Show more
          </button>
          <span className="muted queue-more__note">
            Showing {shown.length} of {rows.length}
          </span>
        </div>
      )}

      {selected && renderDetail && renderDetail(selected, close)}
    </>
  );
}
