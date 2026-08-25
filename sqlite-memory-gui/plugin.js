/**
 * SQLite Persistent Memory — Official Hermes Desktop UI Style
 *
 * Implements a clean, 2-column master-detail layout consistent with
 * Hermes official Skills and Toolsets pages.
 */

import {
  cn,
  Codicon,
  host,
  ROUTES_AREA,
  SIDEBAR_NAV_AREA,
  Tip
} from '@hermes/plugin-sdk'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

let _rest = null

async function api(path, options = {}) {
  // 1. Try ctx.rest first (Desktop SDK native bridge)
  if (_rest) {
    try {
      const cleanPath = path.startsWith('/') ? path.slice(1) : path
      return await _rest(cleanPath, options)
    } catch (e) {
      console.warn('ctx.rest call error, falling back to fetch:', e)
    }
  }

  // 2. Direct fetch fallback with session token auth
  const token = typeof window !== 'undefined' ? (window.__HERMES_SESSION_TOKEN__ || '') : ''
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {})
  }
  const fullUrl = path.startsWith('/api') ? path : `/api/plugins/sqlite_memory${path.startsWith('/') ? path : '/' + path}`

  const res = await fetch(fullUrl, {
    ...options,
    headers,
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  return await res.json()
}

function MemoryManagementPage() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('all')
  const [categories, setCategories] = useState({})
  const [selectedId, setSelectedId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Edit / Add modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingItem, setEditingItem] = useState(null)
  const [formContent, setFormContent] = useState('')
  const [formCategory, setFormCategory] = useState('preference')
  const [saving, setSaving] = useState(false)

  // Load stats
  const loadStats = useCallback(async () => {
    try {
      const data = await api('/stats')
      if (data && data.categories) {
        setCategories(data.categories)
      }
    } catch (e) {
      console.warn('Failed to load stats', e)
    }
  }, [])

  // Load memories list
  const loadMemories = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('query', query.trim())
      if (selectedCategory !== 'all') params.set('category', selectedCategory)
      params.set('limit', '100')

      const data = await api(`/memories?${params.toString()}`)
      const memoryItems = data.items || []
      setItems(memoryItems)
      setTotal(data.total || 0)

      if (memoryItems.length > 0) {
        setSelectedId((prev) => (prev && memoryItems.some(i => i.id === prev) ? prev : memoryItems[0].id))
      } else {
        setSelectedId(null)
      }
    } catch (e) {
      console.error('Failed to load memories', e)
      setError(e.message || 'データ取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [query, selectedCategory])

  useEffect(() => {
    loadStats()
    loadMemories()
  }, [loadStats, loadMemories])

  // Selected memory item
  const activeMemory = useMemo(() => items.find((i) => i.id === selectedId) || null, [items, selectedId])

  // Save new / edited memory
  const handleSave = async (e) => {
    e.preventDefault()
    if (!formContent.trim()) return
    setSaving(true)
    try {
      if (editingItem) {
        await api(`/memories/${editingItem.id}`, {
          method: 'PUT',
          body: { content: formContent.trim(), category: formCategory }
        })
      } else {
        const created = await api('/memories', {
          method: 'POST',
          body: { content: formContent.trim(), category: formCategory }
        })
        if (created && created.id) setSelectedId(created.id)
      }
      setShowAddModal(false)
      setEditingItem(null)
      setFormContent('')
      loadStats()
      loadMemories()
    } catch (e) {
      alert('保存に失敗しました: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // Delete memory
  const handleDelete = async (id) => {
    if (!confirm(`記憶 #${id} を削除してもよろしいですか？`)) return
    try {
      await api(`/memories/${id}`, { method: 'DELETE' })
      loadStats()
      loadMemories()
    } catch (e) {
      alert('削除に失敗しました: ' + e.message)
    }
  }

  // Open Edit modal
  const handleOpenEdit = (item) => {
    setEditingItem(item)
    setFormContent(item.content)
    setFormCategory(item.category || 'preference')
    setShowAddModal(true)
  }

  // Open Create modal
  const handleOpenCreate = () => {
    setEditingItem(null)
    setFormContent('')
    setFormCategory('preference')
    setShowAddModal(true)
  }

  const categoryTabs = [
    { key: 'all', label: 'すべて', count: total },
    { key: 'preference', label: '設定・好み', count: categories['preference'] || 0 },
    { key: 'project', label: 'プロジェクト', count: categories['project'] || 0 },
    { key: 'rule', label: 'ルール', count: categories['rule'] || 0 },
    { key: 'general', label: '一般', count: categories['general'] || 0 }
  ]

  return jsxs('div', {
    className: 'flex flex-col h-full w-full bg-[var(--background,#ffffff)] text-[var(--foreground,#111827)] select-none',
    children: [
      // Top Navigation / Header
      jsxs('div', {
        className: 'flex items-center justify-between px-6 pt-4 pb-3 border-b border-[var(--border,#e5e7eb)]',
        children: [
          // Search input on left
          jsxs('div', {
            className: 'relative flex items-center w-72',
            children: [
              jsx('span', {
                className: 'absolute left-3 text-[var(--muted-foreground,#6b7280)] opacity-70',
                children: jsx(Codicon, { name: 'search', size: '0.875rem' })
              }),
              jsx('input', {
                type: 'text',
                placeholder: '「Rust」などを検索',
                value: query,
                onChange: (e) => setQuery(e.target.value),
                className: 'w-full bg-[var(--muted,#f3f4f6)]/60 hover:bg-[var(--muted,#f3f4f6)] focus:bg-[var(--background,#ffffff)] border border-transparent focus:border-[var(--border,#d1d5db)] rounded-md pl-9 pr-3 py-1.5 text-xs text-[var(--foreground,#111827)] placeholder-[var(--muted-foreground,#9ca3af)] focus:outline-none transition-all'
              })
            ]
          }),

          // Category tabs in center
          jsxs('div', {
            className: 'flex items-center gap-6 text-xs font-medium',
            children: categoryTabs.map((tab) => (
              jsxs('button', {
                key: tab.key,
                onClick: () => setSelectedCategory(tab.key),
                className: cn(
                  'pb-1 transition-all flex items-center gap-1.5 relative',
                  selectedCategory === tab.key
                    ? 'text-[var(--foreground,#111827)] font-semibold border-b-2 border-[var(--foreground,#111827)]'
                    : 'text-[var(--muted-foreground,#6b7280)] hover:text-[var(--foreground,#111827)]'
                ),
                children: [
                  jsx('span', { children: tab.label }),
                  tab.count > 0 && (
                    jsx('span', {
                      className: 'text-[0.6875rem] opacity-60 tabular-nums',
                      children: tab.count
                    })
                  )
                ]
              })
            ))
          }),

          // Action Button on right
          jsx('button', {
            onClick: handleOpenCreate,
            className: 'px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--primary,#18181b)] text-[var(--primary-foreground,#ffffff)] hover:opacity-90 transition-opacity flex items-center gap-1.5 shadow-sm',
            children: [jsx(Codicon, { name: 'add', size: '0.8rem' }), ' 記憶を追加']
          })
        ]
      }),

      // Sub-bar (Status info)
      jsxs('div', {
        className: 'flex items-center justify-between px-6 py-2 bg-[var(--muted,#f9fafb)]/50 border-b border-[var(--border,#e5e7eb)] text-xs text-[var(--muted-foreground,#6b7280)]',
        children: [
          jsxs('div', {
            className: 'flex items-center gap-2',
            children: [
              jsx('span', { children: 'Storage:' }),
              jsx('span', { className: 'font-medium text-[var(--foreground,#111827)]', children: 'SQLite (~/.hermes/memory.db)' })
            ]
          }),
          jsxs('div', {
            className: 'flex items-center gap-4',
            children: [
              jsx('span', { children: `合計: ${total} 件` }),
              jsx('button', {
                onClick: () => { loadStats(); loadMemories(); },
                className: 'hover:text-[var(--foreground,#111827)] flex items-center gap-1 transition-colors',
                children: [jsx(Codicon, { name: 'refresh', size: '0.75rem' }), ' 更新']
              })
            ]
          })
        ]
      }),

      // Main 2-Column Content Layout
      jsxs('div', {
        className: 'flex flex-1 overflow-hidden',
        children: [
          // Left column: Items List
          jsxs('div', {
            className: 'w-[380px] min-w-[320px] border-r border-[var(--border,#e5e7eb)] flex flex-col overflow-y-auto',
            children: [
              loading ? (
                jsx('div', {
                  className: 'flex items-center justify-center p-12 text-xs text-[var(--muted-foreground,#6b7280)]',
                  children: '読み込み中...'
                })
              ) : items.length === 0 ? (
                jsxs('div', {
                  className: 'p-8 text-center text-xs text-[var(--muted-foreground,#6b7280)] space-y-2',
                  children: [
                    jsx('div', { className: 'font-medium text-[var(--foreground,#111827)]', children: query ? '一致する記憶が見つかりません' : 'まだ記憶がありません' }),
                    jsx('p', {
                      className: 'text-[0.6875rem] opacity-75 leading-relaxed',
                      children: query
                        ? '別のキーワードで検索をお試しください。'
                        : '会話中に自動記録されるか、右上の「+ 記憶を追加」から登録できます。'
                    })
                  ]
                })
              ) : (
                items.map((item) => {
                  const isSelected = item.id === selectedId
                  return jsxs('div', {
                    key: item.id,
                    onClick: () => setSelectedId(item.id),
                    className: cn(
                      'px-4 py-3 border-b border-[var(--border,#f0f2f5)] cursor-pointer transition-colors flex items-start justify-between gap-3',
                      isSelected
                        ? 'bg-[var(--muted,#f3f4f6)] text-[var(--foreground,#111827)] font-medium'
                        : 'hover:bg-[var(--muted,#f9fafb)] text-[var(--foreground,#374151)]'
                    ),
                    children: [
                      jsxs('div', {
                        className: 'space-y-1 flex-1 min-w-0',
                        children: [
                          jsxs('div', {
                            className: 'flex items-center gap-2',
                            children: [
                              jsx('span', {
                                className: cn(
                                  'px-1.5 py-0.5 rounded text-[0.625rem] font-semibold uppercase tracking-wider',
                                  item.category === 'preference'
                                    ? 'bg-blue-100 text-blue-800'
                                    : item.category === 'project'
                                    ? 'bg-purple-100 text-purple-800'
                                    : item.category === 'rule'
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-gray-100 text-gray-700'
                                ),
                                children: item.category || 'general'
                              }),
                              jsx('span', {
                                className: 'text-[0.6875rem] text-[var(--muted-foreground,#6b7280)]',
                                children: `#${item.id}`
                              })
                            ]
                          }),
                          jsx('p', {
                            className: 'text-xs line-clamp-2 leading-snug break-words text-[var(--foreground,#1f2937)]',
                            children: item.content
                          })
                        ]
                      }),
                      jsx('span', {
                        className: 'text-[0.625rem] text-[var(--muted-foreground,#9ca3af)] shrink-0 pt-0.5 tabular-nums',
                        children: (item.created_at || '').split(' ')[0]
                      })
                    ]
                  })
                })
              )
            ]
          }),

          // Right column: Detail & Preview View
          jsx('div', {
            className: 'flex-1 overflow-y-auto p-8 bg-[var(--background,#ffffff)]',
            children: activeMemory ? (
              jsxs('div', {
                className: 'max-w-2xl space-y-6',
                children: [
                  // Top Title & Badges
                  jsxs('div', {
                    className: 'flex items-start justify-between gap-4',
                    children: [
                      jsxs('div', {
                        className: 'space-y-1.5',
                        children: [
                          jsxs('div', {
                            className: 'flex items-center gap-2',
                            children: [
                              jsx('h2', {
                                className: 'text-lg font-bold text-[var(--foreground,#111827)] tracking-tight',
                                children: `Memory #${activeMemory.id}`
                              }),
                              jsx('span', {
                                className: 'px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--muted,#e5e7eb)] text-[var(--foreground,#374151)]',
                                children: activeMemory.category || 'general'
                              })
                            ]
                          }),
                          jsx('p', {
                            className: 'text-xs text-[var(--muted-foreground,#6b7280)]',
                            children: 'セッション開始前の自動想起 (Prefetch) および検索ツールから参照されます。'
                          })
                        ]
                      }),
                      // Action buttons
                      jsxs('div', {
                        className: 'flex items-center gap-2 shrink-0',
                        children: [
                          jsx('button', {
                            onClick: () => handleOpenEdit(activeMemory),
                            className: 'px-3 py-1.5 rounded-md text-xs font-medium border border-[var(--border,#d1d5db)] hover:bg-[var(--muted,#f3f4f6)] text-[var(--foreground,#111827)] transition-colors',
                            children: '編集'
                          }),
                          jsx('button', {
                            onClick: () => handleDelete(activeMemory.id),
                            className: 'px-3 py-1.5 rounded-md text-xs font-medium border border-red-200 text-red-600 hover:bg-red-50 transition-colors',
                            children: '削除'
                          })
                        ]
                      })
                    ]
                  }),

                  // Content Body Box
                  jsxs('div', {
                    className: 'space-y-2',
                    children: [
                      jsx('h3', { className: 'text-xs font-semibold text-[var(--muted-foreground,#6b7280)] uppercase tracking-wider', children: '記憶内容' }),
                      jsx('div', {
                        className: 'p-4 rounded-lg bg-[var(--muted,#f9fafb)] border border-[var(--border,#e5e7eb)] text-sm text-[var(--foreground,#111827)] leading-relaxed whitespace-pre-wrap font-sans select-text',
                        children: activeMemory.content
                      })
                    ]
                  }),

                  // Metadata Specs Table
                  jsxs('div', {
                    className: 'p-4 rounded-lg bg-[var(--muted,#f9fafb)] border border-[var(--border,#e5e7eb)] space-y-3 text-xs',
                    children: [
                      jsxs('div', {
                        className: 'grid grid-cols-[120px_1fr] gap-2',
                        children: [
                          jsx('span', { className: 'text-[var(--muted-foreground,#6b7280)]', children: 'ID' }),
                          jsx('span', { className: 'font-mono text-[var(--foreground,#111827)]', children: `#${activeMemory.id}` })
                        ]
                      }),
                      jsxs('div', {
                        className: 'grid grid-cols-[120px_1fr] gap-2',
                        children: [
                          jsx('span', { className: 'text-[var(--muted-foreground,#6b7280)]', children: 'Category' }),
                          jsx('span', { className: 'font-mono text-[var(--foreground,#111827)]', children: activeMemory.category || 'general' })
                        ]
                      }),
                      jsxs('div', {
                        className: 'grid grid-cols-[120px_1fr] gap-2',
                        children: [
                          jsx('span', { className: 'text-[var(--muted-foreground,#6b7280)]', children: 'Source' }),
                          jsx('span', { className: 'text-[var(--foreground,#111827)]', children: activeMemory.source || 'manual' })
                        ]
                      }),
                      jsxs('div', {
                        className: 'grid grid-cols-[120px_1fr] gap-2',
                        children: [
                          jsx('span', { className: 'text-[var(--muted-foreground,#6b7280)]', children: 'Created At' }),
                          jsx('span', { className: 'font-mono text-[var(--foreground,#111827)] tabular-nums', children: activeMemory.created_at || '-' })
                        ]
                      }),
                      jsxs('div', {
                        className: 'grid grid-cols-[120px_1fr] gap-2',
                        children: [
                          jsx('span', { className: 'text-[var(--muted-foreground,#6b7280)]', children: 'Updated At' }),
                          jsx('span', { className: 'font-mono text-[var(--foreground,#111827)] tabular-nums', children: activeMemory.updated_at || '-' })
                        ]
                      })
                    ]
                  })
                ]
              })
            ) : (
              jsxs('div', {
                className: 'h-full flex flex-col items-center justify-center text-center text-xs text-[var(--muted-foreground,#6b7280)] p-8 space-y-2',
                children: [
                  jsx('div', {
                    className: 'font-medium text-sm text-[var(--foreground,#111827)]',
                    children: items.length === 0 ? 'このプロフィールにはまだ記憶がありません' : '左側のリストから記憶を選択してください'
                  }),
                  jsx('p', {
                    className: 'text-xs text-[var(--muted-foreground,#6b7280)] max-w-sm',
                    children: items.length === 0
                      ? '右上の「+ 記憶を追加」から手動で登録するか、会話中にエージェントへ「覚えておいて」と指示すると自動で蓄積されます。'
                      : '選択すると内容の全文確認、編集、削除が行えます。'
                  })
                ]
              })
            )
          })
        ]
      }),

      // Add / Edit Modal
      showAddModal && (
        jsx('div', {
          className: 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4',
          children: jsxs('div', {
            className: 'w-full max-w-lg bg-[var(--background,#ffffff)] border border-[var(--border,#e5e7eb)] rounded-xl p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-100',
            children: [
              jsxs('div', {
                className: 'flex items-center justify-between',
                children: [
                  jsx('h3', {
                    className: 'text-sm font-bold text-[var(--foreground,#111827)]',
                    children: editingItem ? '記憶を編集' : '新しい記憶を追加'
                  }),
                  jsx('button', {
                    onClick: () => setShowAddModal(false),
                    className: 'text-[var(--muted-foreground,#6b7280)] hover:text-[var(--foreground,#111827)]',
                    children: jsx(Codicon, { name: 'close', size: '1rem' })
                  })
                ]
              }),
              jsxs('form', {
                onSubmit: handleSave,
                className: 'space-y-4',
                children: [
                  jsxs('div', {
                    className: 'space-y-1.5',
                    children: [
                      jsx('label', { className: 'text-xs font-medium text-[var(--foreground,#374151)]', children: 'カテゴリ' }),
                      jsx('select', {
                        value: formCategory,
                        onChange: (e) => setFormCategory(e.target.value),
                        className: 'w-full bg-[var(--muted,#f9fafb)] border border-[var(--border,#d1d5db)] rounded-md px-3 py-1.5 text-xs text-[var(--foreground,#111827)] focus:outline-none focus:border-[var(--primary,#18181b)]',
                        children: [
                          jsx('option', { value: 'preference', children: '設定・好み (preference)' }),
                          jsx('option', { value: 'project', children: 'プロジェクト (project)' }),
                          jsx('option', { value: 'rule', children: 'ルール (rule)' }),
                          jsx('option', { value: 'general', children: '一般 (general)' })
                        ]
                      })
                    ]
                  }),
                  jsxs('div', {
                    className: 'space-y-1.5',
                    children: [
                      jsx('label', { className: 'text-xs font-medium text-[var(--foreground,#374151)]', children: '記憶内容' }),
                      jsx('textarea', {
                        rows: 5,
                        required: true,
                        placeholder: '例: ユーザーはフロントエンドでVanilla CSSを優先する方針',
                        value: formContent,
                        onChange: (e) => setFormContent(e.target.value),
                        className: 'w-full bg-[var(--muted,#f9fafb)] border border-[var(--border,#d1d5db)] rounded-md p-3 text-xs text-[var(--foreground,#111827)] placeholder-[var(--muted-foreground,#9ca3af)] focus:outline-none focus:border-[var(--primary,#18181b)] leading-relaxed'
                      })
                    ]
                  }),
                  jsxs('div', {
                    className: 'flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--border,#e5e7eb)]',
                    children: [
                      jsx('button', {
                        type: 'button',
                        onClick: () => setShowAddModal(false),
                        className: 'px-3 py-1.5 rounded-md text-xs border border-[var(--border,#d1d5db)] hover:bg-[var(--muted,#f3f4f6)] text-[var(--foreground,#374151)]',
                        children: 'キャンセル'
                      }),
                      jsx('button', {
                        type: 'submit',
                        disabled: saving || !formContent.trim(),
                        className: 'px-4 py-1.5 rounded-md text-xs font-medium bg-[var(--primary,#18181b)] text-[var(--primary-foreground,#ffffff)] hover:opacity-90 disabled:opacity-50 transition-opacity',
                        children: saving ? '保存中...' : '保存する'
                      })
                    ]
                  })
                ]
              })
            ]
          })
        })
      )
    ]
  })
}

export default {
  id: 'sqlite_memory',
  name: 'Persistent Memory',
  description: 'SQLite-backed persistent long-term memory browser and manager.',
  defaultEnabled: true,
  register(ctx) {
    _rest = ctx.rest
    ctx.registerMany([
      {
        id: 'memory-page',
        area: ROUTES_AREA,
        data: { path: '/memory' },
        render: () => jsx(MemoryManagementPage, {})
      },
      {
        id: 'memory-nav',
        area: SIDEBAR_NAV_AREA,
        order: 45,
        data: { codicon: 'bookmark', label: 'Memory', path: '/memory' }
      }
    ])
  }
}
