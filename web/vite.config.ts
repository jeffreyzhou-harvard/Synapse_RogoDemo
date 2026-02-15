import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/health': 'http://localhost:4000',
      '/plan': 'http://localhost:4000',
      '/prioritize': 'http://localhost:4000',
      '/refine': 'http://localhost:4000',
      '/execute-task': 'http://localhost:4000',
      '/sandbox': 'http://localhost:4000',
      '/rfc': 'http://localhost:4000',
      '/graph': 'http://localhost:4000',
      '/hotspots': 'http://localhost:4000',
      '/runbook': 'http://localhost:4000',
      '/knowledge-graph': 'http://localhost:4000',
      '/specs': 'http://localhost:4000',
      '/slack': 'http://localhost:4000',
      '/analyze-design-doc': 'http://localhost:4000',
      '/accept-suggestion': 'http://localhost:4000',
      '/detect-mentions': 'http://localhost:4000',
      '/delegate-to-agent': 'http://localhost:4000',
      '/commit-changes': 'http://localhost:4000',
      '/create-pr': 'http://localhost:4000',
      '/llm': 'http://localhost:4000',
      '/generate-quiz': 'http://localhost:4000',
      '/explain-concept': 'http://localhost:4000',
      '/learning-progress': 'http://localhost:4000',
      '/inline-ai': 'http://localhost:4000',
      '/generate-paper': 'http://localhost:4000',
      '/transcribe': 'http://localhost:4000',
      '/extract-pdf': 'http://localhost:4000',
      '/refine-question': 'http://localhost:4000',
      '/deep-dive/next-steps': 'http://localhost:4000',
      '/deep-dive': 'http://localhost:4000',
      '/semantic-search': 'http://localhost:4000',
      '/vector': 'http://localhost:4000'
    }
  },
  resolve: {
    alias: { '@': resolve(__dirname, './src') }
  }
});

