import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:8000',
      '/plan': 'http://localhost:8000',
      '/prioritize': 'http://localhost:8000',
      '/refine': 'http://localhost:8000',
      '/execute-task': 'http://localhost:8000',
      '/sandbox': 'http://localhost:8000',
      '/rfc': 'http://localhost:8000',
      '/graph': 'http://localhost:8000',
      '/hotspots': 'http://localhost:8000',
      '/runbook': 'http://localhost:8000',
      '/knowledge-graph': 'http://localhost:8000',
      '/specs': 'http://localhost:8000',
      '/slack': 'http://localhost:8000',
      '/analyze-design-doc': 'http://localhost:8000',
      '/accept-suggestion': 'http://localhost:8000',
      '/detect-mentions': 'http://localhost:8000',
      '/delegate-to-agent': 'http://localhost:8000',
      '/commit-changes': 'http://localhost:8000',
      '/create-pr': 'http://localhost:8000',
      '/llm': 'http://localhost:8000'
    }
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') }
  }
});

