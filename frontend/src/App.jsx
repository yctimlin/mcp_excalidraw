import React, { useState, useEffect, useRef } from 'react'
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const websocketRef = useRef(null)

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

  const loadExistingElements = async () => {
    try {
      const response = await fetch('/api/elements')
      const result = await response.json()
      
      if (result.success && result.elements && result.elements.length > 0) {
        const convertedElements = convertToExcalidrawElements(result.elements)
        excalidrawAPI.updateScene({ elements: convertedElements })
      }
    } catch (error) {
      console.error('Error loading existing elements:', error)
    }
  }

  const connectWebSocket = () => {
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
    
    websocketRef.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        handleWebSocketMessage(data)
      } catch (error) {
        console.error('Error parsing WebSocket message:', error, event.data)
      }
    }
    
    websocketRef.current.onclose = (event) => {
      setIsConnected(false)
      
      // Reconnect after 3 seconds if not a clean close
      if (event.code !== 1000) {
        setTimeout(connectWebSocket, 3000)
      }
    }
    
    websocketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error)
      setIsConnected(false)
    }
  }

  const handleWebSocketMessage = (data) => {
    if (!excalidrawAPI) {
      return
    }

    try {
      const currentElements = excalidrawAPI.getSceneElements()

      switch (data.type) {
        case 'initial_elements':
          if (data.elements && data.elements.length > 0) {
            const convertedElements = convertToExcalidrawElements(data.elements)
            excalidrawAPI.updateScene({ elements: convertedElements })
          }
          break
          
        case 'element_created':
          const newElement = convertToExcalidrawElements([data.element])
          const updatedElementsAfterCreate = [...currentElements, ...newElement]
          excalidrawAPI.updateScene({ elements: updatedElementsAfterCreate })
          break
          
        case 'element_updated':
          const convertedUpdatedElement = convertToExcalidrawElements([data.element])[0]
          const updatedElements = currentElements.map(el => 
            el.id === data.element.id ? convertedUpdatedElement : el
          )
          excalidrawAPI.updateScene({ elements: updatedElements })
          break
          
        case 'element_deleted':
          const filteredElements = currentElements.filter(el => el.id !== data.elementId)
          excalidrawAPI.updateScene({ elements: filteredElements })
          break
          
        case 'elements_batch_created':
          const batchElements = convertToExcalidrawElements(data.elements)
          const updatedElementsAfterBatch = [...currentElements, ...batchElements]
          excalidrawAPI.updateScene({ elements: updatedElementsAfterBatch })
          break
          
        default:
          console.log('Unknown WebSocket message type:', data.type)
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error, data)
    }
  }

  const clearCanvas = async () => {
    if (excalidrawAPI) {
      try {
        // Get all current elements and delete them from backend
        const response = await fetch('/api/elements')
        const result = await response.json()
        
        if (result.success && result.elements) {
          const deletePromises = result.elements.map(element => 
            fetch(`/api/elements/${element.id}`, { method: 'DELETE' })
          )
          await Promise.all(deletePromises)
        }
        
        // Clear the frontend canvas
        excalidrawAPI.updateScene({ elements: [] })
      } catch (error) {
        console.error('Error clearing canvas:', error)
        // Still clear frontend even if backend fails
        excalidrawAPI.updateScene({ elements: [] })
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
          <button className="btn-secondary" onClick={clearCanvas}>Clear Canvas</button>
        </div>
      </div>

      {/* Canvas Container */}
      <div className="canvas-container">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
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