import type { ReactNode } from 'react'

type WorkbenchProps = {
  brandMark: string
  brandLine: string
  brandSub: string
  children: ReactNode
  resultTitle: string
  resultAction?: ReactNode
  result?: ReactNode
  resultEmpty?: string
  resultFlush?: boolean
}

export function Workbench({
  brandMark,
  brandLine,
  brandSub,
  children,
  resultTitle,
  resultAction,
  result,
  resultEmpty = '结果将显示在这里',
  resultFlush = false,
}: WorkbenchProps) {
  return (
    <div className="workbench">
      <section className="ops-pane">
        <header className="brand">
          <div className="brand-titles">
            <p className="brand-mark">{brandMark}</p>
            <h1 className="brand-line">{brandLine}</h1>
          </div>
          <p className="brand-sub">{brandSub}</p>
        </header>
        <div className="ops-pane-body">{children}</div>
      </section>

      <aside className="result-pane" aria-label={resultTitle}>
        <div className="result-pane-head">
          <strong>{resultTitle}</strong>
          {resultAction ? (
            <div className="result-pane-actions">{resultAction}</div>
          ) : null}
        </div>
        <div
          className={`result-pane-body${resultFlush ? ' is-flush' : ''}`}
        >
          {result ?? (
            <div className="result-empty">
              <p>{resultEmpty}</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
