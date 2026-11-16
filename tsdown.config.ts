import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', testing: 'src/testing.ts' },
  tsconfig: 'tsconfig.build.json',
  fixedExtension: false,
  sourcemap: true,
});
