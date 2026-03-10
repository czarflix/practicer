import { useEffect, useMemo, useRef } from 'react'
import MonacoEditor from '@monaco-editor/react'
import { useTheme } from '../../context/ThemeContext'

const DARK_THEME = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: '', foreground: 'ededed', background: '000000' },
    { token: 'comment', foreground: '666666' },
    { token: 'keyword', foreground: '14b8a6' },
    { token: 'string', foreground: 'c9c9c9' },
    { token: 'number', foreground: 'c9c9c9' },
  ],
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#ededed',
    'editorLineNumber.foreground': '#666666',
    'editorLineNumber.activeForeground': '#ededed',
    'editorCursor.foreground': '#14b8a6',
    'editor.selectionBackground': '#113432',
    'editor.lineHighlightBackground': '#0a0a0a',
    'editorIndentGuide.background1': '#1a1a1a',
    'editorIndentGuide.activeBackground1': '#2b2b2b',
    'editorWidget.background': '#111111',
    'editorWidget.border': '#1a1a1a',
  },
}

const LIGHT_THEME = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: '', foreground: '111111', background: 'f5f5f5' },
    { token: 'comment', foreground: '5f5f5f' },
    { token: 'keyword', foreground: '0d9488' },
    { token: 'string', foreground: '333333' },
    { token: 'number', foreground: '333333' },
  ],
  colors: {
    'editor.background': '#f5f5f5',
    'editor.foreground': '#111111',
    'editorLineNumber.foreground': '#707070',
    'editorLineNumber.activeForeground': '#111111',
    'editorCursor.foreground': '#0d9488',
    'editor.selectionBackground': '#caeeea',
    'editor.lineHighlightBackground': '#ebebeb',
    'editorIndentGuide.background1': '#d8d8d8',
    'editorIndentGuide.activeBackground1': '#b9b9b9',
    'editorWidget.background': '#ffffff',
    'editorWidget.border': '#d8d8d8',
  },
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] text-text-muted">
      <span>{label}</span>
      <input
        value={value ?? ''}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="h-8 min-w-0 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
      />
    </label>
  )
}

function normalizePythonCode(value) {
  const lines = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\t/g, '    ').replace(/[ \t]+$/g, ''))

  let normalized = lines.join('\n').replace(/\n{4,}/g, '\n\n\n')
  normalized = normalized.replace(/^\n+/, '')

  if (normalized && !normalized.endsWith('\n')) {
    normalized += '\n'
  }

  return normalized
}

function cleanModelContents(editor, model) {
  const currentValue = model.getValue()
  const cleanedValue = normalizePythonCode(currentValue)

  if (cleanedValue !== currentValue) {
    editor.pushUndoStop()
    editor.executeEdits('paste-cleanup', [
      {
        range: model.getFullModelRange(),
        text: cleanedValue,
        forceMoveMarkers: true,
      },
    ])
    editor.pushUndoStop()
  }

  return cleanedValue
}

async function reindentEditorModel(editor, model) {
  const reindentAction =
    editor.getAction('editor.action.reindentlines') ||
    editor.getAction('editor.action.reindentselectedlines')

  if (!reindentAction) {
    return
  }

  const previousSelection = editor.getSelection()
  editor.setSelection(model.getFullModelRange())

  try {
    await reindentAction.run()
  } catch {
    // Monaco doesn't always expose a working reindent action for every embedded model state.
  } finally {
    if (previousSelection) {
      editor.setSelection(previousSelection)
    }
  }
}

export function CodeEditor({
  code,
  language,
  runtime,
  space,
  onCodeChange,
  onLanguageChange,
  onRuntimeChange,
  onSpaceChange,
  className = '',
  pythonOnly = false,
  readOnly = false,
  height = '360px',
  languageOptions = null,
  showComplexityFields = true,
}) {
  const editorRef = useRef(null)
  const { isDark } = useTheme()
  const themeName = isDark ? 'dsa-dark' : 'dsa-light'
  const defaultLanguages = useMemo(() => {
    if (pythonOnly) {
      return [{ value: 'python', label: 'Python' }]
    }

    return languageOptions ?? [
      { value: 'python', label: 'Python' },
      { value: 'sql', label: 'SQL' },
      { value: 'javascript', label: 'JavaScript' },
      { value: 'typescript', label: 'TypeScript' },
      { value: 'java', label: 'Java' },
      { value: 'cpp', label: 'C++' },
      { value: 'go', label: 'Go' },
    ]
  }, [languageOptions, pythonOnly])

  const activeLanguage = pythonOnly ? 'python' : language || defaultLanguages[0]?.value || 'python'
  const isLockedSqlWorkspace =
    !showComplexityFields &&
    activeLanguage === 'sql' &&
    Array.isArray(defaultLanguages) &&
    defaultLanguages.length === 1
  const wrapperStyle = useMemo(() => ({ height }), [height])

  const options = useMemo(
    () => ({
      minimap: { enabled: false },
      fontFamily: 'Geist Mono',
      fontSize: 13,
      lineHeight: 20,
      tabSize: activeLanguage === 'python' ? 4 : 2,
      insertSpaces: true,
      detectIndentation: false,
      autoIndent: 'full',
      smoothScrolling: true,
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      bracketPairColorization: { enabled: true },
      automaticLayout: true,
      padding: { top: 8, bottom: 8 },
      readOnly,
    }),
    [activeLanguage, readOnly],
  )

  useEffect(() => {
    if (editorRef.current?.monaco) {
      editorRef.current.monaco.editor.setTheme(themeName)
    }
  }, [themeName])

  useEffect(() => {
    return () => {
      if (editorRef.current?.pasteDisposable) {
        editorRef.current.pasteDisposable.dispose()
      }
    }
  }, [])

  return (
    <div className={`flex min-h-0 min-w-0 flex-col overflow-hidden border border-border-subtle bg-base ${className}`} style={wrapperStyle}>
      <div
        className={[
          'border-b border-border-subtle p-2',
          showComplexityFields ? 'grid grid-cols-1 gap-2 md:grid-cols-3' : 'flex items-center justify-between gap-2',
        ].join(' ')}
      >
        {isLockedSqlWorkspace ? (
          <div className="flex min-w-0 flex-col gap-1 text-[11px] text-text-muted">
            <span>Engine</span>
            <div className="flex h-8 min-w-0 items-center border border-border-subtle bg-base px-2 text-xs font-medium text-text-primary">
              PostgreSQL 14
            </div>
          </div>
        ) : (
          <label className="flex min-w-0 flex-col gap-1 text-[11px] text-text-muted">
            <span>Language</span>
            <select
              value={activeLanguage}
              onChange={(event) => onLanguageChange?.(event.target.value)}
              disabled={pythonOnly}
              className="h-8 min-w-0 border border-border-subtle bg-base px-2 text-xs text-text-primary outline-none focus:border-accent"
            >
              {defaultLanguages.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {showComplexityFields ? (
          <>
            <Input
              label="Runtime"
              value={runtime}
              onChange={onRuntimeChange}
              placeholder="O(n log n)"
            />

            <Input
              label="Space"
              value={space}
              onChange={onSpaceChange}
              placeholder="O(1)"
            />
          </>
        ) : (
          <p className="ml-auto text-[11px] text-text-muted">Query workspace</p>
        )}
      </div>

      <div className="min-h-0 min-w-0 flex-1">
        <MonacoEditor
          height="100%"
          language={activeLanguage}
          value={code ?? ''}
          onChange={(value) => onCodeChange?.(value ?? '')}
          options={options}
          theme={themeName}
          onMount={(editor, monaco) => {
            monaco.editor.defineTheme('dsa-dark', DARK_THEME)
            monaco.editor.defineTheme('dsa-light', LIGHT_THEME)
            monaco.editor.setTheme(themeName)

            const pasteDisposable = editor.onDidPaste(() => {
              window.setTimeout(() => {
                const model = editor.getModel()
                if (!model || model.getLanguageId() !== 'python') {
                  return
                }

                cleanModelContents(editor, model)

                if (readOnly) {
                  return
                }

                void reindentEditorModel(editor, model)
              }, 0)
            })

            editorRef.current = { editor, monaco, pasteDisposable }
          }}
        />
      </div>
    </div>
  )
}
