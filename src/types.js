// Excalidraw element types
export const EXCALIDRAW_ELEMENT_TYPES = {
  RECTANGLE: 'rectangle',
  ELLIPSE: 'ellipse',
  DIAMOND: 'diamond',
  ARROW: 'arrow',
  TEXT: 'text',
  LABEL: 'label',
  FREEDRAW: 'freedraw',
  LINE: 'line'
};

// In-memory storage for Excalidraw elements
export const elements = new Map();

// Validation function for Excalidraw elements
export function validateElement(element) {
  const requiredFields = ['type', 'x', 'y'];
  const hasRequiredFields = requiredFields.every(field => field in element);
  
  if (!hasRequiredFields) {
    throw new Error(`Missing required fields: ${requiredFields.join(', ')}`);
  }

  if (!Object.values(EXCALIDRAW_ELEMENT_TYPES).includes(element.type)) {
    throw new Error(`Invalid element type: ${element.type}`);
  }

  return true;
}

// Helper function to generate unique IDs
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
} 