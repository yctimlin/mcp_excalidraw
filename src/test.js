import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

process.stderr.write('MCP SDK imports successful\n');
process.stderr.write(`Server: ${Server}\n`);
process.stderr.write(`StdioServerTransport: ${StdioServerTransport}\n`);

// Exit gracefully
process.exit(0); 