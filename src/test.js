import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

console.log('MCP SDK imports successful');
console.log('Server:', Server);
console.log('StdioServerTransport:', StdioServerTransport);

// Exit gracefully
process.exit(0); 