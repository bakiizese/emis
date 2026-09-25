import type { ReactNode } from 'react';

/** Bordered table used by the settings lists. Pass <tr> rows as children. */
export function SimpleTable({
  head,
  children,
  empty,
}: {
  head: string[];
  children: ReactNode;
  /** Shown as a single row when there's nothing to list. */
  empty?: string | null;
}) {
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-muted-foreground text-xs uppercase">
          <tr>
            {head.map((label, i) => (
              <th key={i} className={label ? 'px-4 py-3 font-medium' : 'sr-only'}>
                {label || 'Actions'}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {children}
          {empty ? (
            <tr>
              <td colSpan={head.length} className="text-muted-foreground px-4 py-8 text-center">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
