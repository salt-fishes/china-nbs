import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/mcp.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  splitting: false,
  treeshake: true,
  external: ['undici', 'zod', /^@modelcontextprotocol\/sdk/],
  outDir: 'dist',
});
