import { ChatDeepSeek } from "@langchain/deepseek";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadMcpTools } from "@langchain/mcp-adapters";
import logger from "./utils/logger.js";
import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

// Express server configuration
const EXPRESS_SERVER_URL =
  process.env.EXPRESS_SERVER_URL || "http://localhost:3000";

// Base system prompt
const BASE_SYSTEM_PROMPT = `You are an AI assistant that helps users create and modify Excalidraw diagrams through natural language commands.

You have access to a set of tools that can interact with an Excalidraw canvas. Your job is to understand the user's request and use the appropriate tools to accomplish their goal.

Important guidelines for creating diagrams:
1. Use batch_create_elements for creating multiple elements at once
2. For arrows, use startElementId and endElementId to bind them to shapes
3. Assign custom IDs to shapes (e.g., "service-a", "database-b") so arrows can reference them
4. Use appropriate colors from the palette:
   - Blue (#1971c2) for services/primary elements
   - Green (#2f9e44) for success/positive elements
   - Red (#e03131) for errors/negative elements
   - Purple (#9c36b5) for middleware/queues
   - Orange (#e8590c) for async/event elements
   - Cyan (#0c8599) for data stores/databases
5. Size shapes appropriately: minimum 120px width, 60px height
6. Leave at least 40px spacing between elements
7. Use text field to label shapes
8. For complex diagrams, create elements in logical groups

When responding:
1. First understand what the user wants to create or modify
2. Check current canvas state with describe_scene if needed
3. Plan the diagram layout with appropriate coordinates
4. Execute the necessary tool calls
5. Provide feedback on what was created

Always be helpful and explain what you're doing.`;

// Initialize LangChain LLM (with fallback if no API key)
let llm: ChatDeepSeek | null = null;
let tools: any[] = [];
let llmWithTools: any = null;

try {
  if (
    process.env.DEEPSEEK_API_KEY &&
    process.env.DEEPSEEK_API_KEY !== "your_deepseek_api_key_here"
  ) {
    llm = new ChatDeepSeek({
      model: "deepseek-chat",
      temperature: 0.1,
      apiKey: process.env.DEEPSEEK_API_KEY,
    });
    logger.info("LangChain LLM initialized with DeepSeek API key");
  } else {
    logger.warn(
      "No valid DeepSeek API key found. Chat functionality will use simple pattern matching.",
    );
  }
} catch (error: any) {
  console.log("-----", error);
  logger.error("Failed to initialize LangChain LLM:", error);
}

// Simple pattern matching for common diagram requests
function processSimpleRequest(userMessage: string): string {
  const lowerMessage = userMessage.toLowerCase();

  if (
    lowerMessage.includes("flowchart") ||
    lowerMessage.includes("flow chart")
  ) {
    return "I would create a flowchart with rectangles for steps and arrows connecting them. For a 3-step flowchart, I would create rectangles at positions (100,100), (100,200), (100,300) with arrows connecting them.";
  }

  if (
    lowerMessage.includes("architecture") ||
    lowerMessage.includes("system diagram")
  ) {
    return "I would create an architecture diagram with services (blue rectangles), databases (cyan ellipses), and arrows showing connections between them.";
  }

  if (lowerMessage.includes("clear") || lowerMessage.includes("empty")) {
    return "I would clear the canvas using the clear_canvas tool.";
  }

  if (lowerMessage.includes("mermaid")) {
    return "I would convert the Mermaid diagram to Excalidraw elements using the create_from_mermaid tool.";
  }

  return "I understand you want to create or modify a diagram. Please provide more specific details about what you'd like to create.";
}

// Helper function to get current canvas state
async function getCanvasState(): Promise<string> {
  try {
    const response = await fetch(`${EXPRESS_SERVER_URL}/api/elements`);
    if (!response.ok) {
      return "Unable to fetch canvas state.";
    }

    const data = (await response.json()) as any;
    const elements = data.elements || [];

    if (elements.length === 0) {
      return "The canvas is empty.";
    }

    return `Canvas contains ${elements.length} elements.`;
  } catch (error) {
    return "Unable to fetch canvas state.";
  }
}

// Initialize MCP tools via stdio
async function initializeMCPTools(): Promise<boolean> {
  try {
    logger.info("Initializing MCP tools via stdio...");

    const serverParams = {
      command: "node",
      args: ["dist/index.js"],
    };

    // Create Stdio client transport
    const transport = new StdioClientTransport(serverParams);
    
    // Create MCP client with the transport
    const client = new Client(
      {
        name: "excalidraw-chat-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
    
    // Connect the client
    await client.connect(transport);

    // Load the tools from the MCP server
    const loadedTools = await loadMcpTools("excalidraw-server", client);

    if (loadedTools.length === 0) {
      logger.error("No tools loaded from MCP server");
      return false;
    }

    tools = loadedTools;
    logger.info(`Successfully loaded ${tools.length} tools from MCP server`);

    // Bind tools to the LLM
    if (llm) {
      llmWithTools = llm.bindTools(tools);
    }

    return true;
  } catch (error: any) {
    logger.error("Failed to initialize MCP tools:", error);
    return false;
  }
}

// Main chat function with proper tool calling
export async function processChatRequest(userMessage: string): Promise<string> {
  try {
    logger.info("Processing chat request", { userMessage });

    if (!llm) {
      // Fallback to simple pattern matching
      const simpleResponse = processSimpleRequest(userMessage);
      return `I understand you want to: "${userMessage}"\n\n${simpleResponse}\n\nNote: To use full AI capabilities, please set a valid DEEPSEEK_API_KEY in your .env file.`;
    }

    // Initialize tools if not already initialized
    if (tools.length === 0) {
      const initialized = await initializeMCPTools();
      if (!initialized) {
        return "Failed to initialize MCP tools. Please check if the MCP server is running.";
      }
    }

    if (!llmWithTools) {
      return "LLM with tools not initialized. Please check the configuration.";
    }

    // Get current canvas state
    const canvasState = await getCanvasState();

    // Create messages
    const messages = [
      new SystemMessage(BASE_SYSTEM_PROMPT),
      new HumanMessage(
        `Current canvas state: ${canvasState}\n\nUser request: ${userMessage}`,
      ),
    ];

    let currentMessages: any[] = [...messages];
    let finalResponse = "";
    let iteration = 0;
    const maxIterations = 10;

    // Loop for multiple tool call iterations
    while (iteration < maxIterations) {
      iteration++;
      console.log(`\n=== Iteration ${iteration} ===`);

      // Get LLM response
      const response = await llmWithTools.invoke(currentMessages);
      console.log("Model response:", response);

      // Add the response to messages
      currentMessages.push(response);

      // Check if the model wants to call tools
      if (response.tool_calls && response.tool_calls.length > 0) {
        console.log(`Model wants to call ${response.tool_calls.length} tools`);

        // Execute all requested tools
        for (const toolCall of response.tool_calls) {
          const toolName = toolCall.name;
          const toolArgs = toolCall.args;
          const toolId = toolCall.id;

          // Find the tool
          const selectedTool = tools.find((t) => t.name === toolName);
          if (selectedTool) {
            try {
              // Execute the tool
              console.log(`Executing tool: ${toolName}`, toolArgs);
              const toolResult = await selectedTool.invoke(toolArgs);
              console.log(`Tool ${toolName} result:`, toolResult);

              // Add tool result to messages
              currentMessages.push({
                role: "tool",
                tool_call_id: toolId,
                content: JSON.stringify(toolResult, null, 2),
              });
            } catch (error: any) {
              logger.error(`Error executing tool ${toolName}:`, error);
              currentMessages.push({
                role: "tool",
                tool_call_id: toolId,
                content: `Error executing tool ${toolName}: ${error.message}`,
              });
            }
          } else {
            logger.warn(`Tool ${toolName} not found`);
            currentMessages.push({
              role: "tool",
              tool_call_id: toolId,
              content: `Tool ${toolName} not found. Available tools: ${tools.map((t) => t.name).join(", ")}`,
            });
          }
        }

        // Continue to next iteration to let LLM process tool results
        continue;
      } else {
        // No more tool calls, use this as final response
        console.log("No more tool calls, using as final response");
        finalResponse = response.content.toString();
        break;
      }
    }

    // Check if we hit the iteration limit
    if (iteration >= maxIterations) {
      finalResponse = `Reached maximum tool call iterations (${maxIterations}).\n\nLast response: ${finalResponse}`;
    }

    return `I've processed your request: "${userMessage}"\n\n${finalResponse}`;
  } catch (error: any) {
    logger.error("Error processing chat request:", error);

    // Fallback response
    const simpleResponse = processSimpleRequest(userMessage);
    return `I understand you want to: "${userMessage}"\n\n${simpleResponse}\n\nNote: There was an error processing your request with AI. ${error.message}`;
  }
}

// Export the main function
export default {
  processChatRequest,
};