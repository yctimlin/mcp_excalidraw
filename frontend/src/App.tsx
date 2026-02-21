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

type SyncStatus = 'idle' | 'syncing' | 'success' | 'error';

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

function App(): JSX.Element {
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawAPIRefValue | null>(null)
  const [isConnected, setIsConnected] = useState<boolean>(false)
  const websocketRef = useRef<WebSocket | null>(null)

  // Sync state management
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('idle')
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null)

  // Auto-sync debouncing
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null)

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

  const loadExistingElements = async (): Promise<void> => {
    try {
      const response = await fetch('/api/elements')
      const result: ApiResponse = await response.json()
      
      if (result.success && result.elements && result.elements.length > 0) {
        const cleanedElements = result.elements.map(cleanElementForExcalidraw)
        const convertedElements = convertToExcalidrawElements(cleanedElements, { regenerateIds: false })
        excalidrawAPI?.updateScene({ elements: convertedElements })
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
                  headers: { 'Content-Type': 'application/json' },
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
                      headers: { 'Content-Type': 'application/json' },
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
                      headers: { 'Content-Type': 'application/json' },
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
                    headers: { 'Content-Type': 'application/json' },
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
                headers: { 'Content-Type': 'application/json' },
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
                headers: { 'Content-Type': 'application/json' },
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
                headers: { 'Content-Type': 'application/json' },
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
          
        default:
          console.log('Unknown WebSocket message type:', data.type)
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error, data)
    }
  }

  // Data format conversion for backend
  const convertToBackendFormat = (element: ExcalidrawElement): ServerElement => {
    return {
      ...element
    } as ServerElement
  }

  // Format sync time display
  const formatSyncTime = (time: Date | null): string => {
    if (!time) return ''
    return time.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  // Main sync function
  const syncToBackend = async (): Promise<void> => {
    if (!excalidrawAPI) {
      console.warn('Excalidraw API not available')
      return
    }
    
    setSyncStatus('syncing')
    
    try {
      // 1. Get current elements
      const currentElements = excalidrawAPI.getSceneElements()
      console.log(`Syncing ${currentElements.length} elements to backend`)
      
      // Filter out deleted elements
      const activeElements = currentElements.filter(el => !el.isDeleted)
      
      // 3. Convert to backend format
      const backendElements = activeElements.map(convertToBackendFormat)
      
      // 4. Send to backend
      const response = await fetch('/api/elements/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          elements: backendElements,
          timestamp: new Date().toISOString()
        })
      })
      
      if (response.ok) {
        const result: ApiResponse = await response.json()
        setSyncStatus('success')
        setLastSyncTime(new Date())
        console.log(`Sync successful: ${result.count} elements synced`)
        
        // Reset status after 2 seconds
        setTimeout(() => setSyncStatus('idle'), 2000)
      } else {
        const error: ApiResponse = await response.json()
        setSyncStatus('error')
        console.error('Sync failed:', error.error)
      }
    } catch (error) {
      setSyncStatus('error')
      console.error('Sync error:', error)
    }
  }

  // Auto-sync with debouncing to avoid excessive API calls
  const debouncedAutoSync = async (): Promise<void> => {
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current)
    }

    syncTimeoutRef.current = setTimeout(async () => {
      try {
        await syncToBackend()
      } catch (error) {
        console.error('Auto-sync failed:', error)
      }
    }, 1000) // Wait 1 second after last change before syncing
  }

  // Handle canvas changes
  const handleCanvasChange = (elements: readonly ExcalidrawElement[]) => {
    // Trigger auto-sync after debounce delay
    debouncedAutoSync()
  }

  const clearCanvas = async (): Promise<void> => {
    if (excalidrawAPI) {
      try {
        // Get all current elements and delete them from backend
        const response = await fetch('/api/elements')
        const result: ApiResponse = await response.json()

        if (result.success && result.elements) {
          const deletePromises = result.elements.map(element =>
            fetch(`/api/elements/${element.id}`, { method: 'DELETE' })
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
        <h1>Excalidraw Canvas</h1>
        <div className="controls">
          <div className="status">
            <div className={`status-dot ${isConnected ? 'status-connected' : 'status-disconnected'}`}></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          
          {/* Sync Controls */}
          <div className="sync-controls">
            <button 
              className={`btn-primary ${syncStatus === 'syncing' ? 'btn-loading' : ''}`}
              onClick={syncToBackend}
              disabled={syncStatus === 'syncing' || !excalidrawAPI}
            >
              {syncStatus === 'syncing' && <span className="spinner"></span>}
              {syncStatus === 'syncing' ? 'Syncing...' : 'Sync to Backend'}
            </button>
            
            {/* Sync Status */}
            <div className="sync-status">
              {syncStatus === 'success' && (
                <span className="sync-success">✅ Synced</span>
              )}
              {syncStatus === 'error' && (
                <span className="sync-error">❌ Sync Failed</span>
              )}
              {lastSyncTime && syncStatus === 'idle' && (
                <span className="sync-time">
                  Last sync: {formatSyncTime(lastSyncTime)}
                </span>
              )}
            </div>
          </div>
          
          <button className="btn-secondary" onClick={clearCanvas}>Clear Canvas</button>
        </div>
      </div>

      {/* Canvas Container */}
      <div className="canvas-container">
        <Excalidraw
          excalidrawAPI={(api: ExcalidrawAPIRefValue) => setExcalidrawAPI(api)}
          onChange={handleCanvasChange}
          initialData={{
            elements: [],
            appState: {
              theme: 'light',
              viewBackgroundColor: '#ffffff'
            }
          }}
        />
      </div>
    </div>
  )
}

export default App
