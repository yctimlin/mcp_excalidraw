import React, { useState, useEffect, useRef } from 'react'
import {
  Excalidraw,
  convertToExcalidrawElements,
  CaptureUpdateAction,
  ExcalidrawImperativeAPI,
  exportToBlob,
  exportToSvg
} from '@excalidraw/excalidraw'
import type { ExcalidrawElement, NonDeleted, NonDeletedExcalidrawElement } from '@excalidraw/excalidraw/types/element/types'
import { convertMermaidToExcalidraw, DEFAULT_MERMAID_CONFIG } from './utils/mermaidConverter'
import type { MermaidConfig } from '@excalidraw/mermaid-to-excalidraw'

// Type definitions
type ExcalidrawAPIRefValue = ExcalidrawImperativeAPI;

interface ServerElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  backgroundColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  roughness?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string | number;
  label?: {
    text: string;
  };
  createdAt?: string;
  updatedAt?: string;
  version?: number;
  syncedAt?: string;
  source?: string;
  syncTimestamp?: string;
  boundElements?: any[] | null;
  containerId?: string | null;
  locked?: boolean;
  // Arrow element binding
  start?: { id: string };
  end?: { id: string };
  strokeStyle?: string;
  endArrowhead?: string;
  startArrowhead?: string;
}

interface WebSocketMessage {
  type: string;
  element?: ServerElement;
  elements?: ServerElement[];
  elementId?: string;
  count?: number;
  timestamp?: string;
  source?: string;
  mermaidDiagram?: string;
  config?: MermaidConfig;
}

interface ApiResponse {
  success: boolean;
  elements?: ServerElement[];
  element?: ServerElement;
  count?: number;
  error?: string;
  message?: string;
}

type SyncStatus = 'idle' | 'syncing';

// Helper function to clean elements for Excalidraw
const cleanElementForExcalidraw = (element: ServerElement): Partial<ExcalidrawElement> => {
  const {
    createdAt,
    updatedAt,
    version,
    syncedAt,
    source,
    syncTimestamp,
    ...cleanElement
  } = element;
  return cleanElement;
}

// Helper function to validate and fix element binding data
const validateAndFixBindings = (elements: Partial<ExcalidrawElement>[]): Partial<ExcalidrawElement>[] => {
  const elementMap = new Map(elements.map(el => [el.id!, el]));
  
  return elements.map(element => {
    const fixedElement = { ...element };
    
    // Validate and fix boundElements
    if (fixedElement.boundElements) {
      if (Array.isArray(fixedElement.boundElements)) {
        fixedElement.boundElements = fixedElement.boundElements.filter((binding: any) => {
          // Ensure binding has required properties
          if (!binding || typeof binding !== 'object') return false;
          if (!binding.id || !binding.type) return false;
          
          // Ensure the referenced element exists
          const referencedElement = elementMap.get(binding.id);
          if (!referencedElement) return false;
          
          // Validate binding type
          if (!['text', 'arrow'].includes(binding.type)) return false;
          
          return true;
        });
        
        // Remove boundElements if empty
        if (fixedElement.boundElements.length === 0) {
          fixedElement.boundElements = null;
        }
      } else {
        // Invalid boundElements format, set to null
        fixedElement.boundElements = null;
      }
    }
    
    // Validate and fix containerId
    if (fixedElement.containerId) {
      const containerElement = elementMap.get(fixedElement.containerId);
      if (!containerElement) {
        // Container doesn't exist, remove containerId
        fixedElement.containerId = null;
      }
    }
    
    return fixedElement;
  });
}

interface TenantInfo {
  id: string;
  name: string;
  workspace_path: string;
}

function App(): JSX.Element {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawAPIRefValue | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const websocketRef = useRef<WebSocket | null>(null)
  
  // Sync state
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    const stored = localStorage.getItem('excalidraw-autosave')
    return stored === null ? true : stored === 'true'
  })
  const isSyncingRef = useRef<boolean>(false)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSyncedHashRef = useRef<string>('')

  const DEBOUNCE_MS = 3000

  // Tenant state
  const [activeTenant, setActiveTenant] = useState<TenantInfo | null>(null)
  const activeTenantIdRef = useRef<string | null>(null)
  const [tenantList, setTenantList] = useState<TenantInfo[]>([])
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const [tenantSearch, setTenantSearch] = useState<string>('')
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Keep ref in sync so closures (WebSocket handlers) always see latest tenant
  useEffect(() => {
    activeTenantIdRef.current = activeTenant?.id ?? null
  }, [activeTenant])

  // Build headers with tenant ID for all fetch calls to the backend
  const tenantHeaders = (extra?: Record<string, string>): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...extra
    }
    const tid = activeTenantIdRef.current
    if (tid) headers['X-Tenant-Id'] = tid
    return headers
  }

  // WebSocket connection
  useEffect(() => {
    connectWebSocket()
    return () => {
      if (websocketRef.current) {
        websocketRef.current.close()
      }
    }
  }, [])

  // Load existing elements when Excalidraw API becomes available
  useEffect(() => {
    if (excalidrawAPI) {
      loadExistingElements()
      
      // Ensure WebSocket is connected for real-time updates
      if (!isConnected) {
        connectWebSocket()
      }
    }
  }, [excalidrawAPI, isConnected])

  const computeElementHash = (elements: readonly { id: string; version: number }[]): string => {
    let h = String(elements.length)
    for (let i = 0; i < elements.length; i++) {
      h += elements[i].id
      h += elements[i].version
    }
    return h
  }

  // Persist auto-save preference and cancel pending timer when toggled off
  const toggleAutoSave = () => {
    setAutoSave(prev => {
      const next = !prev
      localStorage.setItem('excalidraw-autosave', String(next))
      if (!next && debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
        debounceTimerRef.current = null
      }
      return next
    })
  }

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)
    }
  }, [])

  // Trailing debounce: resets on every change, fires after user is idle.
  // Only active when auto-save is on.
  const handleCanvasChange = (): void => {
    if (!autoSave) return

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current)

    debounceTimerRef.current = setTimeout(() => {
      if (!excalidrawAPI || isSyncingRef.current) return

      const elements = excalidrawAPI.getSceneElements()
      const hash = computeElementHash(elements)
      if (hash === lastSyncedHashRef.current) return

      syncToBackend()
    }, DEBOUNCE_MS)
  }

  const loadExistingElements = async (): Promise<void> => {
    try {
      const response = await fetch('/api/elements', { headers: tenantHeaders() })
      const result: ApiResponse = await response.json()
      
      if (result.success && result.elements && result.elements.length > 0) {
        const cleanedElements = result.elements.map(cleanElementForExcalidraw)
        // Elements with containerId are in Excalidraw native format (from a
        // previous sync before the normalization fix). Pass them directly —
        // convertToExcalidrawElements would re-create bound text and break layout.
        const hasNativeFormat = cleanedElements.some((el: any) => el.containerId)
        if (hasNativeFormat) {
          const validated = validateAndFixBindings(cleanedElements)
          excalidrawAPI?.updateScene({ elements: validated as any })
        } else {
          const convertedElements = convertToExcalidrawElements(cleanedElements, { regenerateIds: false })
          excalidrawAPI?.updateScene({ elements: convertedElements })
        }
      }
    } catch (error) {
      console.error('Error loading existing elements:', error)
    }
  }

  const connectWebSocket = (): void => {
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}`
    
    websocketRef.current = new WebSocket(wsUrl)
    
    websocketRef.current.onopen = () => {
      setIsConnected(true)
      
      if (excalidrawAPI) {
        setTimeout(loadExistingElements, 100)
      }
    }
    
    websocketRef.current.onmessage = (event: MessageEvent) => {
      try {
        const data: WebSocketMessage = JSON.parse(event.data)
        handleWebSocketMessage(data)
      } catch (error) {
        console.error('Error parsing WebSocket message:', error, event.data)
      }
    }
    
    websocketRef.current.onclose = (event: CloseEvent) => {
      setIsConnected(false)
      
      // Reconnect after 3 seconds if not a clean close
      if (event.code !== 1000) {
        setTimeout(connectWebSocket, 3000)
      }
    }
    
    websocketRef.current.onerror = (error: Event) => {
      console.error('WebSocket error:', error)
      setIsConnected(false)
    }
  }

  const handleWebSocketMessage = async (data: WebSocketMessage): Promise<void> => {
    if (!excalidrawAPI) {
      return
    }

    try {
      const currentElements = excalidrawAPI.getSceneElements()
      console.log('Current elements:', currentElements);

      switch (data.type) {
        case 'initial_elements':
          if (data.elements && data.elements.length > 0) {
            const cleanedElements = data.elements.map(cleanElementForExcalidraw)
            const validatedElements = validateAndFixBindings(cleanedElements)
            // Preserve server IDs so later update/delete websocket events can match by id.
            const convertedElements = convertToExcalidrawElements(validatedElements, { regenerateIds: false })
            excalidrawAPI.updateScene({
              elements: convertedElements,
              captureUpdate: CaptureUpdateAction.NEVER
            })
          }
          break

        case 'element_created':
          if (data.element) {
            const cleanedNewElement = cleanElementForExcalidraw(data.element)
            const hasBindings = (cleanedNewElement as any).start || (cleanedNewElement as any).end
            if (hasBindings) {
              // Bound arrow: re-convert all elements together so bindings resolve
              const allElements = [...currentElements, cleanedNewElement] as any[]
              const convertedAll = convertToExcalidrawElements(allElements, { regenerateIds: false })
              excalidrawAPI.updateScene({
                elements: convertedAll,
                captureUpdate: CaptureUpdateAction.NEVER
              })
            } else {
              // Preserve server IDs so later update/delete websocket events can match by id.
              const newElement = convertToExcalidrawElements([cleanedNewElement], { regenerateIds: false })
              const updatedElementsAfterCreate = [...currentElements, ...newElement]
              excalidrawAPI.updateScene({
                elements: updatedElementsAfterCreate,
                captureUpdate: CaptureUpdateAction.NEVER
              })
            }
          }
          break
          
        case 'element_updated':
          if (data.element) {
            const cleanedUpdatedElement = cleanElementForExcalidraw(data.element)
            // Preserve server IDs so we can replace the existing element by id.
            const convertedUpdatedElement = convertToExcalidrawElements([cleanedUpdatedElement], { regenerateIds: false })[0]
            const updatedElements = currentElements.map(el =>
              el.id === data.element!.id ? convertedUpdatedElement : el
            )
            excalidrawAPI.updateScene({
              elements: updatedElements,
              captureUpdate: CaptureUpdateAction.NEVER
            })
          }
          break

        case 'element_deleted':
          if (data.elementId) {
            const filteredElements = currentElements.filter(el => el.id !== data.elementId)
            excalidrawAPI.updateScene({
              elements: filteredElements,
              captureUpdate: CaptureUpdateAction.NEVER
            })
          }
          break

        case 'elements_batch_created':
          if (data.elements) {
            const cleanedBatchElements = data.elements.map(cleanElementForExcalidraw)
            const hasBoundArrows = cleanedBatchElements.some((el: any) => el.start || el.end)
            if (hasBoundArrows) {
              // Convert ALL elements together so arrow bindings resolve to target shapes
              const allElements = [...currentElements, ...cleanedBatchElements] as any[]
              const convertedAll = convertToExcalidrawElements(allElements, { regenerateIds: false })
              excalidrawAPI.updateScene({
                elements: convertedAll,
                captureUpdate: CaptureUpdateAction.NEVER
              })
            } else {
              // Preserve server IDs so later update/delete websocket events can match by id.
              const batchElements = convertToExcalidrawElements(cleanedBatchElements, { regenerateIds: false })
              const updatedElementsAfterBatch = [...currentElements, ...batchElements]
              excalidrawAPI.updateScene({
                elements: updatedElementsAfterBatch,
                captureUpdate: CaptureUpdateAction.NEVER
              })
            }
          }
          break
          
        case 'elements_synced':
          console.log(`Sync confirmed by server: ${data.count} elements`)
          // Sync confirmation already handled by HTTP response
          break
          
        case 'sync_status':
          console.log(`Server sync status: ${data.count} elements`)
          break
          
        case 'canvas_cleared':
          console.log('Canvas cleared by server')
          excalidrawAPI.updateScene({
            elements: [],
            captureUpdate: CaptureUpdateAction.NEVER
          })
          break

        case 'export_image_request':
          console.log('Received image export request', data)
          if (data.requestId) {
            try {
              const elements = excalidrawAPI.getSceneElements()
              const appState = excalidrawAPI.getAppState()
              const files = excalidrawAPI.getFiles()

              if (data.format === 'svg') {
                const svg = await exportToSvg({
                  elements,
                  appState: {
                    ...appState,
                    exportBackground: data.background !== false
                  },
                  files
                })
                const svgString = new XMLSerializer().serializeToString(svg)
                await fetch('/api/export/image/result', {
                  method: 'POST',
                  headers: tenantHeaders(),
                  body: JSON.stringify({
                    requestId: data.requestId,
                    format: 'svg',
                    data: svgString
                  })
                })
              } else {
                const blob = await exportToBlob({
                  elements,
                  appState: {
                    ...appState,
                    exportBackground: data.background !== false
                  },
                  files,
                  mimeType: 'image/png'
                })
                const reader = new FileReader()
                reader.onload = async () => {
                  try {
                    const resultString = reader.result as string
                    const base64 = resultString?.split(',')[1]
                    if (!base64) {
                      throw new Error('Could not extract base64 data from result')
                    }
                    await fetch('/api/export/image/result', {
                      method: 'POST',
                      headers: tenantHeaders(),
                      body: JSON.stringify({
                        requestId: data.requestId,
                        format: 'png',
                        data: base64
                      })
                    })
                  } catch (readerError) {
                    console.error('Image export (FileReader) failed:', readerError)
                    await fetch('/api/export/image/result', {
                      method: 'POST',
                      headers: tenantHeaders(),
                      body: JSON.stringify({
                        requestId: data.requestId,
                        error: (readerError as Error).message
                      })
                    }).catch(() => {})
                  }
                }
                reader.onerror = async () => {
                  console.error('FileReader error:', reader.error)
                  await fetch('/api/export/image/result', {
                    method: 'POST',
                    headers: tenantHeaders(),
                    body: JSON.stringify({
                      requestId: data.requestId,
                      error: reader.error?.message || 'FileReader failed'
                    })
                  }).catch(() => {})
                }
                reader.readAsDataURL(blob)
              }
              console.log('Image export completed for request', data.requestId)
            } catch (exportError) {
              console.error('Image export failed:', exportError)
              await fetch('/api/export/image/result', {
                method: 'POST',
                headers: tenantHeaders(),
                body: JSON.stringify({
                  requestId: data.requestId,
                  error: (exportError as Error).message
                })
              })
            }
          }
          break

        case 'set_viewport':
          console.log('Received viewport control request', data)
          if (data.requestId) {
            try {
              if (data.scrollToContent) {
                const allElements = excalidrawAPI.getSceneElements()
                if (allElements.length > 0) {
                  excalidrawAPI.scrollToContent(allElements, { fitToViewport: true, animate: true })
                }
              } else if (data.scrollToElementId) {
                const allElements = excalidrawAPI.getSceneElements()
                const targetElement = allElements.find(el => el.id === data.scrollToElementId)
                if (targetElement) {
                  excalidrawAPI.scrollToContent([targetElement], { fitToViewport: false, animate: true })
                } else {
                  throw new Error(`Element ${data.scrollToElementId} not found`)
                }
              } else {
                // Direct zoom/scroll control
                const appState: any = {}
                if (data.zoom !== undefined) {
                  appState.zoom = { value: data.zoom }
                }
                if (data.offsetX !== undefined) {
                  appState.scrollX = data.offsetX
                }
                if (data.offsetY !== undefined) {
                  appState.scrollY = data.offsetY
                }
                if (Object.keys(appState).length > 0) {
                  excalidrawAPI.updateScene({ appState })
                }
              }

              await fetch('/api/viewport/result', {
                method: 'POST',
                headers: tenantHeaders(),
                body: JSON.stringify({
                  requestId: data.requestId,
                  success: true,
                  message: 'Viewport updated'
                })
              })
            } catch (viewportError) {
              console.error('Viewport control failed:', viewportError)
              await fetch('/api/viewport/result', {
                method: 'POST',
                headers: tenantHeaders(),
                body: JSON.stringify({
                  requestId: data.requestId,
                  error: (viewportError as Error).message
                })
              }).catch(() => {})
            }
          }
          break

        case 'mermaid_convert':
          console.log('Received Mermaid conversion request from MCP')
          if (data.mermaidDiagram) {
            try {
              const result = await convertMermaidToExcalidraw(data.mermaidDiagram, data.config || DEFAULT_MERMAID_CONFIG)

              if (result.error) {
                console.error('Mermaid conversion error:', result.error)
                return
              }

              if (result.elements && result.elements.length > 0) {
                const convertedElements = convertToExcalidrawElements(result.elements, { regenerateIds: false })
                excalidrawAPI.updateScene({
                  elements: convertedElements,
                  captureUpdate: CaptureUpdateAction.IMMEDIATELY
                })

                if (result.files) {
                  excalidrawAPI.addFiles(Object.values(result.files))
                }

                console.log('Mermaid diagram converted successfully:', result.elements.length, 'elements')

                // Sync to backend automatically after creating elements
                await syncToBackend()
              }
            } catch (error) {
              console.error('Error converting Mermaid diagram from WebSocket:', error)
            }
          }
          break
          
        case 'tenant_switched':
          console.log('Tenant switched:', data.tenant)
          if (data.tenant) {
            const incoming = data.tenant as TenantInfo
            // Only reload if the switch came from an external source (MCP tool)
            // and we aren't already on that tenant (UI-driven switch handles its own reload)
            if (incoming.id !== activeTenantIdRef.current) {
              activeTenantIdRef.current = incoming.id
              setActiveTenant(incoming)
              excalidrawAPI.updateScene({
                elements: [],
                captureUpdate: CaptureUpdateAction.NEVER
              })
              lastSyncedHashRef.current = ''
              loadExistingElements()
            } else {
              setActiveTenant(incoming)
            }
          }
          break

        default:
          console.log('Unknown WebSocket message type:', data.type)
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error, data)
    }
  }

  // Normalize Excalidraw native elements back to MCP format for backend storage.
  // Excalidraw internally splits label text out of containers into separate text
  // elements linked by containerId/boundElements. This causes text to detach on
  // reload because convertToExcalidrawElements doesn't reconstruct that binding.
  // Fix: merge bound text back into container label.text so the backend always
  // stores MCP format that round-trips cleanly.
  const normalizeForBackend = (elements: readonly ExcalidrawElement[]): ServerElement[] => {
    const elementMap = new Map<string, ExcalidrawElement>()
    for (const el of elements) elementMap.set(el.id, el)

    // Collect IDs of text elements that are bound inside a container
    const boundTextIds = new Set<string>()
    // Map containerId → text content for merging
    const containerTextMap = new Map<string, { text: string; fontSize?: number; fontFamily?: number }>()

    for (const el of elements) {
      const cid = (el as any).containerId
      if (el.type === 'text' && cid && elementMap.has(cid)) {
        boundTextIds.add(el.id)
        containerTextMap.set(cid, {
          text: (el as any).text || (el as any).originalText || '',
          fontSize: (el as any).fontSize,
          fontFamily: (el as any).fontFamily,
        })
      }
    }

    const result: ServerElement[] = []
    for (const el of elements) {
      if (boundTextIds.has(el.id)) continue // skip bound text — merged into container

      const out: any = { ...el }

      // If this container has bound text, put it back as label.text
      const merged = containerTextMap.get(el.id)
      if (merged && merged.text) {
        out.label = { text: merged.text }
        if (merged.fontSize) out.fontSize = merged.fontSize
        if (merged.fontFamily) out.fontFamily = merged.fontFamily
        // Clean up Excalidraw-internal binding metadata
        delete out.boundElements
      }

      // Normalize arrow bindings from Excalidraw format back to MCP format
      if (el.type === 'arrow') {
        const startBinding = (el as any).startBinding
        const endBinding = (el as any).endBinding
        if (startBinding?.elementId) out.start = { id: startBinding.elementId }
        if (endBinding?.elementId) out.end = { id: endBinding.elementId }
      }

      result.push(out as ServerElement)
    }
    return result
  }

  // Toast message shown briefly in the center of the header
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = (msg: string, durationMs = 2000) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToast(msg)
    toastTimerRef.current = setTimeout(() => setToast(null), durationMs)
  }

  // Fetch list of tenants for the menu
  const fetchTenants = async () => {
    try {
      const res = await fetch('/api/tenants', { headers: tenantHeaders() })
      if (!res.ok) return
      const data = await res.json()
      if (data.success) {
        setTenantList(data.tenants)
      }
    } catch (err) {
      console.error('Failed to fetch tenants:', err)
    }
  }

  // Switch active tenant via API, then reload canvas with new tenant's elements
  const switchTenant = async (tenantId: string) => {
    if (tenantId === activeTenantIdRef.current) {
      setMenuOpen(false)
      return
    }

    try {
      const res = await fetch('/api/tenant/active', {
        method: 'PUT',
        headers: tenantHeaders(),
        body: JSON.stringify({ tenantId })
      })
      if (!res.ok) return

      // Update ref immediately so subsequent fetch uses the new tenant
      activeTenantIdRef.current = tenantId

      // Clear the canvas before loading the new tenant's elements
      excalidrawAPI?.updateScene({
        elements: [],
        captureUpdate: CaptureUpdateAction.NEVER
      })
      lastSyncedHashRef.current = ''

      // Update React state (will also re-sync the ref via useEffect, which is fine)
      const tenant = tenantList.find(t => t.id === tenantId)
      if (tenant) setActiveTenant(tenant)

      setMenuOpen(false)

      // Load elements for the newly-active tenant
      const elemRes = await fetch('/api/elements', {
        headers: {
          'Content-Type': 'application/json',
          'X-Tenant-Id': tenantId
        }
      })
      const result: ApiResponse = await elemRes.json()
      if (result.success && result.elements && result.elements.length > 0) {
        const cleanedElements = result.elements.map(cleanElementForExcalidraw)
        const hasNativeFormat = cleanedElements.some((el: any) => el.containerId)
        if (hasNativeFormat) {
          const validated = validateAndFixBindings(cleanedElements)
          excalidrawAPI?.updateScene({ elements: validated as any })
        } else {
          const convertedElements = convertToExcalidrawElements(cleanedElements, { regenerateIds: false })
          excalidrawAPI?.updateScene({ elements: convertedElements })
        }
      }

      showToast('Workspace switched')
    } catch (err) {
      console.error('Failed to switch tenant:', err)
    }
  }

  const syncToBackend = async (): Promise<void> => {
    if (!excalidrawAPI || isSyncingRef.current) return

    isSyncingRef.current = true
    setSyncStatus('syncing')

    try {
      const currentElements = excalidrawAPI.getSceneElements()
      const activeElements = currentElements.filter(el => !el.isDeleted)
      const backendElements = normalizeForBackend(activeElements)

      const response = await fetch('/api/elements/sync', {
        method: 'POST',
        headers: tenantHeaders(),
        body: JSON.stringify({
          elements: backendElements,
          timestamp: new Date().toISOString()
        })
      })

      if (response.ok) {
        const result: ApiResponse = await response.json()
        lastSyncedHashRef.current = computeElementHash(currentElements)
        setSyncStatus('idle')
        showToast('Saved')
        console.log(`Sync: ${result.count} elements synced`)
      } else {
        setSyncStatus('idle')
        showToast('Sync failed', 3000)
        console.error('Sync failed:', (await response.json() as ApiResponse).error)
      }
    } catch (error) {
      setSyncStatus('idle')
      showToast('Sync failed', 3000)
      console.error('Sync error:', error)
    } finally {
      isSyncingRef.current = false
    }
  }

  const clearCanvas = async (): Promise<void> => {
    if (excalidrawAPI) {
      try {
        const response = await fetch('/api/elements', { headers: tenantHeaders() })
        const result: ApiResponse = await response.json()
        
        if (result.success && result.elements) {
          const deletePromises = result.elements.map(element => 
            fetch(`/api/elements/${element.id}`, { method: 'DELETE', headers: tenantHeaders() })
          )
          await Promise.all(deletePromises)
        }
        
        // Clear the frontend canvas
        excalidrawAPI.updateScene({ 
          elements: [],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY
        })
      } catch (error) {
        console.error('Error clearing canvas:', error)
        // Still clear frontend even if backend fails
        excalidrawAPI.updateScene({ 
          elements: [],
          captureUpdate: CaptureUpdateAction.IMMEDIATELY
        })
      }
    }
  }

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <div className="header-left">
          <h1>Excalidraw Canvas</h1>
          {activeTenant && (
            <button
              className="tenant-badge-btn"
              onClick={() => {
                setMenuOpen(o => {
                  if (!o) {
                    setTenantSearch('')
                    fetchTenants()
                    setTimeout(() => searchInputRef.current?.focus(), 80)
                  }
                  return !o
                })
              }}
              title="Switch workspace"
            >
              <span className="tenant-label">Workspace:</span> {activeTenant.name} ▾
            </button>
          )}
        </div>

        {toast && <div className="toast">{toast}</div>}

        <div className="controls">
          <div className="status">
            <div className={`status-dot ${isConnected ? 'status-connected' : 'status-disconnected'}`}></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          
          <div className="btn-group">
            <button
              className={`btn-group-item ${syncStatus === 'syncing' ? 'btn-group-busy' : ''}`}
              onClick={syncToBackend}
              disabled={syncStatus === 'syncing' || !excalidrawAPI}
            >
              {syncStatus === 'syncing' ? 'Syncing...' : 'Sync'}
            </button>
            <button
              className="btn-group-item"
              onClick={toggleAutoSave}
              title={autoSave ? 'Auto-sync is on — click to turn off' : 'Auto-sync is off — click to turn on'}
            >
              {autoSave ? 'Auto ✓' : 'Auto ✗'}
            </button>
          </div>
          
          <button className="btn-secondary" onClick={clearCanvas}>Clear Canvas</button>
        </div>
      </div>

      {/* Tenant menu overlay */}
      {menuOpen && (() => {
        const q = tenantSearch.toLowerCase()
        const filtered = q
          ? tenantList.filter(t => t.name.toLowerCase().includes(q) || t.workspace_path.toLowerCase().includes(q))
          : tenantList
        return (
          <div className="menu-overlay" onClick={() => setMenuOpen(false)}>
            <div className="menu-panel" onClick={e => e.stopPropagation()}>
              <div className="menu-header">Workspaces</div>
              <div className="menu-search-wrap">
                <input
                  ref={searchInputRef}
                  className="menu-search"
                  type="text"
                  placeholder="Search workspaces..."
                  value={tenantSearch}
                  onChange={e => setTenantSearch(e.target.value)}
                />
              </div>
              <div className="menu-list">
                {filtered.map(t => (
                  <button
                    key={t.id}
                    className={`menu-item ${activeTenant?.id === t.id ? 'menu-item-active' : ''}`}
                    onClick={() => switchTenant(t.id)}
                  >
                    <span className="menu-item-name">{t.name}</span>
                    <span className="menu-item-path" title={t.workspace_path}>
                      {t.workspace_path.length > 40
                        ? '...' + t.workspace_path.slice(-37)
                        : t.workspace_path}
                    </span>
                    {activeTenant?.id === t.id && <span className="menu-item-check">✓</span>}
                  </button>
                ))}
                {filtered.length === 0 && <div className="menu-empty">No matching workspaces</div>}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Canvas Container */}
      <div className="canvas-container">
        <Excalidraw
          excalidrawAPI={(api: ExcalidrawAPIRefValue) => setExcalidrawAPI(api)}
          initialData={{
            elements: [],
            appState: {
              theme: 'light',
              viewBackgroundColor: '#ffffff'
            }
          }}
          onChange={handleCanvasChange}
        />
      </div>
    </div>
  )
}

export default App
