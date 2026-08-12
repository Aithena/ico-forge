import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

type PreviewDrawerProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  action?: ReactNode
}

export function PreviewDrawer({
  open,
  title,
  onClose,
  children,
  wide = false,
  action,
}: PreviewDrawerProps) {
  if (!open) return null

  return createPortal(
    <aside
      className={`preview-drawer${wide ? ' is-wide' : ''}`}
      role="dialog"
      aria-label={title}
    >
      <div className="preview-drawer-head">
        <strong>{title}</strong>
        <div className="preview-drawer-actions">
          {action}
          <button type="button" className="color-drawer-close" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
      <div className="preview-drawer-body">{children}</div>
    </aside>,
    document.body,
  )
}
