import React, { useState, useEffect, useRef } from 'react'
import { Excalidraw, convertToExcalidrawElements } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'

function App() {
  const [excalidrawAPI, setExcalidrawAPI] = useState(null)
  const [isConnected, setIsConnected] = useState(false)
  const [elementCount, setElementCount] = useState(0)
  const [apiPanelVisible, setApiPanelVisible] = useState(true)
  const [notifications, setNotifications] = useState([])
  const websocketRef = useRef(null)

  // Form state
  const [formData, setFormData] = useState({
    type: 'rectangle',
    x: 100,
    y: 100,
    width: 100,
    height: 100,
    text: '',
    backgroundColor: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 2
  })

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
      console.log('ExcalidrawAPI ready, setting up real-time sync')
      
      // Load existing elements immediately
      loadExistingElements()
      
      // Ensure WebSocket is connected for real-time updates
      if (!isConnected) {
        console.log('ExcalidrawAPI ready but WebSocket not connected, connecting...')
        connectWebSocket()
      } else {
        console.log('Both ExcalidrawAPI and WebSocket are ready for real-time sync')
      }
    }
  }, [excalidrawAPI, isConnected])

  const loadExistingElements = async () => {
    try {
      const response = await fetch('/api/elements')
      const result = await response.json()
      
      if (result.success && result.elements && result.elements.length > 0) {
        console.log('Loading existing elements from API:', result.elements.length)
        const convertedElements = convertToExcalidrawElements(result.elements)
        console.log('Converted existing elements:', convertedElements)
        excalidrawAPI.updateScene({ elements: convertedElements })
      }
    } catch (error) {
      console.error('Error loading existing elements:', error)
    }
  }

  const connectWebSocket = () => {
    if (websocketRef.current && websocketRef.current.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected')
      return
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}`
    
    console.log('Connecting to WebSocket:', wsUrl)
    websocketRef.current = new WebSocket(wsUrl)
    
    websocketRef.current.onopen = () => {
      console.log('WebSocket connected successfully')
      setIsConnected(true)
      
      // Request existing elements when WebSocket connects and API is ready
      if (excalidrawAPI) {
        console.log('WebSocket connected and ExcalidrawAPI ready - requesting refresh')
        setTimeout(loadExistingElements, 100) // Small delay to ensure connection is stable
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
      console.log('WebSocket disconnected:', event.code, event.reason)
      setIsConnected(false)
      
      // Reconnect after 3 seconds if not a clean close
      if (event.code !== 1000) {
        console.log('Attempting to reconnect in 3 seconds...')
        setTimeout(connectWebSocket, 3000)
      }
    }
    
    websocketRef.current.onerror = (error) => {
      console.error('WebSocket error:', error)
      setIsConnected(false)
    }
  }

  const handleWebSocketMessage = (data) => {
    console.log('WebSocket message received:', data.type, data)
    
    if (!excalidrawAPI) {
      console.log('ExcalidrawAPI not ready, skipping message:', data.type)
      return
    }

    try {
      const currentElements = excalidrawAPI.getSceneElements()
      console.log('Current elements count:', currentElements.length)

      switch (data.type) {
        case 'initial_elements':
          if (data.elements && data.elements.length > 0) {
            console.log('Loading initial elements:', data.elements.length)
            const convertedElements = convertToExcalidrawElements(data.elements)
            console.log('Converted initial elements:', convertedElements.length)
            excalidrawAPI.updateScene({ elements: convertedElements })
          }
          break
          
        case 'element_created':
          console.log('Processing element_created:', data.element)
          const newElement = convertToExcalidrawElements([data.element])
          console.log('Converted new element:', newElement)
          const updatedElementsAfterCreate = [...currentElements, ...newElement]
          console.log('Total elements after create:', updatedElementsAfterCreate.length)
          excalidrawAPI.updateScene({ elements: updatedElementsAfterCreate })
          showNotification('Element created successfully!', 'success')
          break
          
        case 'element_updated':
          console.log('Processing element_updated:', data.element.id)
          const convertedUpdatedElement = convertToExcalidrawElements([data.element])[0]
          const updatedElements = currentElements.map(el => 
            el.id === data.element.id ? convertedUpdatedElement : el
          )
          excalidrawAPI.updateScene({ elements: updatedElements })
          showNotification('Element updated successfully!', 'success')
          break
          
        case 'element_deleted':
          console.log('Processing element_deleted:', data.elementId)
          const filteredElements = currentElements.filter(el => el.id !== data.elementId)
          excalidrawAPI.updateScene({ elements: filteredElements })
          showNotification('Element deleted successfully!', 'success')
          break
          
        case 'elements_batch_created':
          console.log('Processing elements_batch_created:', data.elements.length)
          const batchElements = convertToExcalidrawElements(data.elements)
          console.log('Converted batch elements:', batchElements.length)
          const updatedElementsAfterBatch = [...currentElements, ...batchElements]
          console.log('Total elements after batch:', updatedElementsAfterBatch.length)
          excalidrawAPI.updateScene({ elements: updatedElementsAfterBatch })
          showNotification(`${data.elements.length} elements created!`, 'success')
          break
          
        default:
          console.log('Unknown WebSocket message type:', data.type)
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error, data)
      showNotification('Error processing real-time update', 'error')
    }
  }

  const showNotification = (message, type = 'success') => {
    const id = Date.now()
    const notification = { id, message, type }
    setNotifications(prev => [...prev, notification])
    
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id))
    }, 3000)
  }

  const handleExcalidrawChange = (elements, appState, files) => {
    setElementCount(elements.length)
  }

  const handleFormSubmit = async (e) => {
    e.preventDefault()
    
    const elementData = {
      type: formData.type,
      x: parseInt(formData.x),
      y: parseInt(formData.y),
      width: parseInt(formData.width) || undefined,
      height: parseInt(formData.height) || undefined,
      backgroundColor: formData.backgroundColor,
      strokeColor: formData.strokeColor,
      strokeWidth: parseInt(formData.strokeWidth)
    }
    
    if (formData.text) {
      elementData.text = formData.text
    }
    
    // Remove undefined values
    Object.keys(elementData).forEach(key => {
      if (elementData[key] === undefined) {
        delete elementData[key]
      }
    })
    
    try {
      const response = await fetch('/api/elements', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(elementData)
      })
      
      const result = await response.json()
      
      if (result.success) {
        showNotification('Element created via API!', 'success')
        // Reset form positions
        setFormData(prev => ({
          ...prev,
          x: Math.floor(Math.random() * 400) + 50,
          y: Math.floor(Math.random() * 300) + 50
        }))
      } else {
        showNotification(`Error: ${result.error}`, 'error')
      }
    } catch (error) {
      console.error('Error creating element:', error)
      showNotification('Failed to create element', 'error')
    }
  }

  const createSampleElements = async () => {
    const sampleElements = [
      {
        type: 'rectangle',
        x: 50,
        y: 50,
        width: 150,
        height: 100,
        backgroundColor: '#ffeaa7',
        strokeColor: '#2d3436'
      },
      {
        type: 'ellipse',
        x: 250,
        y: 50,
        width: 120,
        height: 120,
        backgroundColor: '#74b9ff',
        strokeColor: '#0984e3'
      },
      {
        type: 'diamond',
        x: 50,
        y: 200,
        width: 100,
        height: 100,
        backgroundColor: '#fd79a8',
        strokeColor: '#e84393'
      },
      {
        type: 'text',
        x: 250,
        y: 220,
        text: 'Hello from API!',
        fontSize: 20,
        strokeColor: '#2d3436'
      }
    ]
    
    try {
      const response = await fetch('/api/elements/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ elements: sampleElements })
      })
      
      const result = await response.json()
      
      if (result.success) {
        showNotification(`${result.count} sample elements created!`, 'success')
      } else {
        showNotification(`Error: ${result.error}`, 'error')
      }
    } catch (error) {
      console.error('Error creating sample elements:', error)
      showNotification('Failed to create sample elements', 'error')
    }
  }

  const clearCanvas = () => {
    if (excalidrawAPI) {
      excalidrawAPI.updateScene({ elements: [] })
      showNotification('Canvas cleared!', 'success')
    }
  }

  const refreshElements = async () => {
    console.log('Manual refresh requested')
    if (excalidrawAPI) {
      await loadExistingElements()
      showNotification('Elements refreshed!', 'success')
    } else {
      showNotification('Canvas not ready yet', 'error')
    }
  }

  const forceReconnectWebSocket = () => {
    console.log('Force reconnecting WebSocket')
    if (websocketRef.current) {
      websocketRef.current.close()
    }
    setTimeout(connectWebSocket, 100)
  }

  const toggleApiPanel = () => {
    setApiPanelVisible(!apiPanelVisible)
  }

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  return (
    <div className="app">
      {/* Header */}
      <div className="header">
        <h1>Excalidraw POC - Backend API Integration</h1>
        <div className="controls">
          <div className="status">
            <div className={`status-dot ${isConnected ? 'status-connected' : 'status-disconnected'}`}></div>
            <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
          </div>
          <div className="element-count">
            Elements: <span>{elementCount}</span>
          </div>
          <button className="btn-secondary" onClick={clearCanvas}>Clear Canvas</button>
          <button className="btn-secondary" onClick={refreshElements}>Refresh Elements</button>
          <button className="btn-primary" onClick={createSampleElements}>Create Sample Elements</button>
          {!isConnected && (
            <button className="btn-danger" onClick={forceReconnectWebSocket}>Reconnect WS</button>
          )}
        </div>
      </div>

      {/* API Panel Toggle */}
      <button className="toggle-panel" onClick={toggleApiPanel}>
        API Panel
      </button>

      {/* API Panel */}
      {apiPanelVisible && (
        <div className="api-panel">
          <h3>Create Element via API</h3>
          <form className="api-form" onSubmit={handleFormSubmit}>
            <div className="form-group">
              <label htmlFor="type">Element Type:</label>
              <select 
                name="type" 
                value={formData.type} 
                onChange={handleInputChange}
                required
              >
                <option value="rectangle">Rectangle</option>
                <option value="ellipse">Ellipse</option>
                <option value="diamond">Diamond</option>
                <option value="text">Text</option>
                <option value="arrow">Arrow</option>
                <option value="line">Line</option>
              </select>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="x">X Position:</label>
                <input 
                  type="number" 
                  name="x" 
                  value={formData.x} 
                  onChange={handleInputChange}
                  required 
                />
              </div>
              <div className="form-group">
                <label htmlFor="y">Y Position:</label>
                <input 
                  type="number" 
                  name="y" 
                  value={formData.y} 
                  onChange={handleInputChange}
                  required 
                />
              </div>
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="width">Width:</label>
                <input 
                  type="number" 
                  name="width" 
                  value={formData.width} 
                  onChange={handleInputChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="height">Height:</label>
                <input 
                  type="number" 
                  name="height" 
                  value={formData.height} 
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="form-group">
              <label htmlFor="text">Text (for text elements):</label>
              <input 
                type="text" 
                name="text" 
                value={formData.text} 
                onChange={handleInputChange}
                placeholder="Enter text content" 
              />
            </div>
            
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="backgroundColor">Background Color:</label>
                <input 
                  type="color" 
                  name="backgroundColor" 
                  value={formData.backgroundColor} 
                  onChange={handleInputChange}
                />
              </div>
              <div className="form-group">
                <label htmlFor="strokeColor">Stroke Color:</label>
                <input 
                  type="color" 
                  name="strokeColor" 
                  value={formData.strokeColor} 
                  onChange={handleInputChange}
                />
              </div>
            </div>
            
            <div className="form-group">
              <label htmlFor="strokeWidth">Stroke Width:</label>
              <input 
                type="number" 
                name="strokeWidth" 
                value={formData.strokeWidth} 
                onChange={handleInputChange}
                min="1" 
                max="10" 
              />
            </div>
            
            <button type="submit" className="btn-success">Create Element</button>
          </form>
        </div>
      )}

      {/* Canvas Container */}
      <div className="canvas-container">
        <Excalidraw
          excalidrawAPI={(api) => setExcalidrawAPI(api)}
          onChange={handleExcalidrawChange}
          initialData={{
            elements: [],
            appState: {
              theme: 'light',
              viewBackgroundColor: '#ffffff'
            }
          }}
        />
      </div>

      {/* Notifications */}
      {notifications.map(notification => (
        <div 
          key={notification.id} 
          className={`notification ${notification.type}`}
          style={{ top: `${20 + notifications.indexOf(notification) * 60}px` }}
        >
          {notification.message}
        </div>
      ))}
    </div>
  )
}

export default App 