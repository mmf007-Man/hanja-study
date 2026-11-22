import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

function removeDirRecursively(dirPath: string): void {
  if (!fs.existsSync(dirPath)) return;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      removeDirRecursively(fullPath);
    } else {
      fs.unlinkSync(fullPath);
    }
  }
  fs.rmdirSync(dirPath);
}

function cleanOutDirPlugin(): Plugin {
  let rootDir = process.cwd();
  let resolvedOutDir = path.resolve(process.cwd(), 'dist');
  return {
    name: 'clean-out-dir',
    apply: 'build',
    configResolved(config) {
      rootDir = config.root;
      resolvedOutDir = path.resolve(config.root, config.build.outDir);
    },
    buildStart() {
      // Work around Node 24 Windows fs.rmSync(recursive: true) crash on non-ASCII paths
      removeDirRecursively(resolvedOutDir);
    },
    closeBundle() {
      const noticesSrc = path.join(rootDir, 'THIRD-PARTY-NOTICES.md');
      if (fs.existsSync(noticesSrc)) {
        fs.mkdirSync(resolvedOutDir, { recursive: true });
        fs.copyFileSync(
          noticesSrc,
          path.join(resolvedOutDir, 'THIRD-PARTY-NOTICES.md'),
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), cleanOutDirPlugin()],
  base: process.env.VITE_BASE_PATH || './',
  build: {
    // Work around Vite 5 emptyOutDir silent exit on Windows Node 24 when dist/ exists
    emptyOutDir: false,
  },
  test: {
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
