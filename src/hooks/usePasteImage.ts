import { useEffect } from 'react'

/** Listen for Ctrl+V / Cmd+V image paste and forward the file. */
export function usePasteImage(onImage: (file: File) => void) {
  useEffect(() => {
    function handlePaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (!item.type.startsWith('image/')) continue
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const named =
          file.name && file.name !== 'image.png'
            ? file
            : new File([file], `paste-${Date.now()}.png`, {
                type: file.type || 'image/png',
              })
        onImage(named)
        return
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [onImage])
}
