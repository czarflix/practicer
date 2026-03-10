import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import {
  Bold,
  Code,
  Download,
  Heading1,
  Heading2,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  Undo2,
} from 'lucide-react'
import { hasSupabaseCredentials, supabase } from '../../lib/supabase'

const lowlight = createLowlight(common)

function getExtensionFromType(type) {
  if (type?.includes('png')) {
    return 'png'
  }

  if (type?.includes('webp')) {
    return 'webp'
  }

  if (type?.includes('gif')) {
    return 'gif'
  }

  return 'jpg'
}

async function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new window.Image()
    const objectUrl = URL.createObjectURL(file)

    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Unable to load image.'))
    }

    image.src = objectUrl
  })
}

async function compressImage(file) {
  const image = await loadImage(file)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas context not available for image compression.')
  }

  const maxSide = 1600
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
  canvas.width = Math.max(1, Math.round(image.width * scale))
  canvas.height = Math.max(1, Math.round(image.height * scale))

  context.drawImage(image, 0, 0, canvas.width, canvas.height)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Image compression failed.'))
          return
        }

        resolve(blob)
      },
      'image/jpeg',
      0.8,
    )
  })
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Failed to encode image.'))
    reader.readAsDataURL(blob)
  })
}

async function uploadImage(file, problemIdentity) {
  const blob = await compressImage(file)

  if (!supabase || !hasSupabaseCredentials) {
    return blobToDataUrl(blob)
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${getExtensionFromType(file.type)}`
  const identitySegment = String(problemIdentity || 'global')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .slice(0, 96) || 'global'
  const storagePath = `${session?.user?.id ?? 'public'}/${identitySegment}/${fileName}`

  const { data, error } = await supabase.storage.from('images').upload(storagePath, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  })

  if (error) {
    if (/row-level security|policy/i.test(error.message || '')) {
      return blobToDataUrl(blob)
    }
    throw error
  }

  const { data: publicData } = supabase.storage.from('images').getPublicUrl(data.path)
  return publicData.publicUrl
}

function normalizeLinkUrl(value) {
  const input = String(value || '').trim()
  if (!input) {
    return ''
  }

  if (/^https?:\/\//i.test(input)) {
    return input
  }

  return `https://${input}`
}

function sanitizeFileName(value) {
  const safe = String(value || 'notes')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 96)

  return safe || 'notes'
}

function ToolbarButton({ active, onClick, children, title, disabled = false, label }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={[
        'inline-flex h-7 items-center justify-center border px-2 text-text-muted transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        label ? 'gap-1 text-[11px]' : 'w-7',
        active ? 'border-accent bg-base text-accent' : 'border-border-subtle hover:border-accent hover:text-accent',
      ].join(' ')}
    >
      {children}
      {label ? <span>{label}</span> : null}
    </button>
  )
}

async function exportNodeToPdf(node, fileName) {
  const rootStyles = getComputedStyle(document.documentElement)
  const backgroundColor = rootStyles.getPropertyValue('--ui-base').trim() || '#ffffff'
  const textColor = rootStyles.getPropertyValue('--ui-text-primary').trim() || '#111111'
  const width = Math.min(840, Math.max(640, node.clientWidth || 640))
  const host = document.createElement('div')

  host.style.position = 'fixed'
  host.style.left = '-100000px'
  host.style.top = '0'
  host.style.width = `${width}px`
  host.style.padding = '24px'
  host.style.background = backgroundColor
  host.style.color = textColor
  host.style.zIndex = '-1'

  const clone = node.cloneNode(true)
  clone.classList.add('note-editor-content')
  clone.style.width = '100%'
  clone.style.maxWidth = '100%'
  clone.style.minHeight = 'auto'

  host.appendChild(clone)
  document.body.appendChild(host)

  try {
    const canvas = await html2canvas(host, {
      backgroundColor,
      scale: 2,
      useCORS: true,
      logging: false,
      windowWidth: host.scrollWidth,
      windowHeight: host.scrollHeight,
    })

    const pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' })
    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const pageCanvasHeight = Math.max(1, Math.floor((pageHeight * canvas.width) / pageWidth))

    let offsetY = 0
    let pageIndex = 0

    while (offsetY < canvas.height) {
      const sliceHeight = Math.min(pageCanvasHeight, canvas.height - offsetY)
      const pageCanvas = document.createElement('canvas')
      const context = pageCanvas.getContext('2d')

      if (!context) {
        throw new Error('Canvas context not available for PDF export.')
      }

      pageCanvas.width = canvas.width
      pageCanvas.height = sliceHeight
      context.drawImage(canvas, 0, offsetY, canvas.width, sliceHeight, 0, 0, canvas.width, sliceHeight)

      if (pageIndex > 0) {
        pdf.addPage()
      }

      const imageHeight = (sliceHeight * pageWidth) / canvas.width
      pdf.addImage(pageCanvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, imageHeight, undefined, 'FAST')

      offsetY += sliceHeight
      pageIndex += 1
    }

    pdf.save(`${sanitizeFileName(fileName)}.pdf`)
  } finally {
    host.remove()
  }
}

export function NoteEditor({
  value,
  onChange,
  problemLc,
  problemKey = '',
  placeholder = 'Write your study notes...',
  className = '',
  exportFileName = 'notes',
  editable = true,
  showToolbar = true,
  allowPdfExport = true,
}) {
  const [uploading, setUploading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkInputValue, setLinkInputValue] = useState('')
  const [linkError, setLinkError] = useState('')
  const imageInputRef = useRef(null)
  const contentRef = useRef(null)
  const problemIdentity = problemKey || problemLc || 'global'

  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        link: false,
      }),
      CodeBlockLowlight.configure({ lowlight }),
      Placeholder.configure({ placeholder }),
      Image,
      Link.configure({
        openOnClick: false,
        autolink: true,
      }),
    ],
    [placeholder],
  )

  const editor = useEditor({
    extensions,
    content: value || { type: 'doc', content: [{ type: 'paragraph' }] },
    editable,
    editorProps: {
      attributes: {
        class:
          'note-editor-content min-h-[220px] w-full px-3 py-3 text-sm leading-relaxed text-text-primary focus:outline-none',
      },
      handlePaste: (_view, event) => {
        const items = Array.from(event.clipboardData?.items ?? [])
        const imageItem = items.find((item) => item.type.startsWith('image/'))

        if (!imageItem) {
          return false
        }

        const file = imageItem.getAsFile()
        if (!file) {
          return false
        }

        event.preventDefault()
        setUploading(true)
        setLinkError('')

        void (async () => {
          try {
            const uploadedUrl = await uploadImage(file, problemIdentity)
            editor?.chain().focus().setImage({ src: uploadedUrl }).run()
          } catch (error) {
            setLinkError(error instanceof Error ? error.message : 'Image upload failed.')
          } finally {
            setUploading(false)
          }
        })()

        return true
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      if (editable) {
        onChange?.(activeEditor.getJSON())
      }
    },
  })

  useEffect(() => {
    if (!editor || !value) {
      return
    }

    const current = editor.getJSON()
    const same = JSON.stringify(current) === JSON.stringify(value)
    if (!same) {
      editor.commands.setContent(value, { emitUpdate: false })
    }
  }, [editor, value])

  useEffect(() => {
    if (!editor) {
      return
    }

    editor.setEditable(editable)
  }, [editable, editor])

  if (!editor) {
    return <div className="min-h-[220px] animate-pulse border border-border-subtle bg-base" />
  }

  const insertLinkFromInput = () => {
    const href = normalizeLinkUrl(linkInputValue)
    if (!href) {
      setLinkError('Link is required.')
      return
    }

    try {
      const activeEditor = editor.chain().focus()
      if (editor.state.selection.empty) {
        activeEditor.insertContent({
          type: 'text',
          text: href,
          marks: [{ type: 'link', attrs: { href } }],
        })
      } else {
        activeEditor.extendMarkRange('link').setLink({ href })
      }
      activeEditor.run()
      setLinkInputValue('')
      setLinkError('')
      setShowLinkInput(false)
    } catch {
      setLinkError('Invalid link.')
    }
  }

  const uploadToolbarImage = async (file) => {
    if (!file) {
      return
    }

    setUploading(true)
    setLinkError('')

    try {
      const uploadedUrl = await uploadImage(file, problemIdentity)
      editor.chain().focus().setImage({ src: uploadedUrl }).run()
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'Image upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const handleExportPdf = async () => {
    const contentNode = contentRef.current?.querySelector('.ProseMirror')
    if (!contentNode) {
      setLinkError('Note content is not ready for export.')
      return
    }

    setExporting(true)
    setLinkError('')

    try {
      await exportNodeToPdf(contentNode, exportFileName)
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : 'PDF export failed.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className={`border border-border-subtle bg-base ${className}`}>
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-border-subtle px-2 py-2">
          <ToolbarButton title="Undo" active={false} onClick={() => editor.chain().focus().undo().run()}>
            <Undo2 size={13} />
          </ToolbarButton>
          <ToolbarButton title="Redo" active={false} onClick={() => editor.chain().focus().redo().run()}>
            <Redo2 size={13} />
          </ToolbarButton>
          <ToolbarButton
            title="Heading 1"
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          >
            <Heading1 size={13} />
          </ToolbarButton>
          <ToolbarButton
            title="Heading 2"
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 size={13} />
          </ToolbarButton>
          <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={13} />
          </ToolbarButton>
          <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={13} />
          </ToolbarButton>
          <ToolbarButton title="Inline Code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code size={13} />
          </ToolbarButton>
          <ToolbarButton
            title="Bullet List"
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            <List size={13} />
          </ToolbarButton>
          <ToolbarButton
            title="Ordered List"
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered size={13} />
          </ToolbarButton>
          <ToolbarButton
            title="Code Block"
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          >
            <Code size={13} />
          </ToolbarButton>
          <ToolbarButton
            title="Insert Link"
            active={editor.isActive('link') || showLinkInput}
            onClick={() => {
              setShowLinkInput((current) => !current)
              setLinkError('')
            }}
          >
            <Link2 size={13} />
          </ToolbarButton>
          <ToolbarButton title="Upload Image" active={false} onClick={() => imageInputRef.current?.click()}>
            <ImageIcon size={13} />
          </ToolbarButton>

          <div className="ml-auto flex items-center gap-1">
            {uploading || exporting ? (
              <span className="px-1 text-[11px] text-text-muted">{uploading ? 'Uploading…' : 'Exporting…'}</span>
            ) : null}
            {allowPdfExport ? (
              <ToolbarButton title="Export PDF" active={false} disabled={exporting} onClick={() => void handleExportPdf()} label="PDF">
                <Download size={12} />
              </ToolbarButton>
            ) : null}
          </div>

          {showLinkInput ? (
            <div className="flex w-full items-center gap-1 border-t border-border-subtle pt-2">
              <input
                value={linkInputValue}
                onChange={(event) => setLinkInputValue(event.target.value)}
                placeholder="https://example.com"
                className="h-7 min-w-0 flex-1 border border-border-subtle bg-surface px-2 text-[11px] text-text-primary outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={insertLinkFromInput}
                className="h-7 border border-accent bg-accent/10 px-2 text-[11px] text-accent"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowLinkInput(false)
                  setLinkInputValue('')
                  setLinkError('')
                }}
                className="h-7 border border-border-subtle px-2 text-[11px] text-text-muted hover:border-accent hover:text-accent"
              >
                Cancel
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) {
            void uploadToolbarImage(file)
          }
          event.target.value = ''
        }}
      />

      {linkError ? <div className="border-b border-border-subtle px-2 py-1 text-[11px] text-text-muted">{linkError}</div> : null}
      <div ref={contentRef}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
