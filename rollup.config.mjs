import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

const actionsPackagePattern = /node_modules[\\/](?:\.pnpm[\\/].*?[\\/])?@actions[\\/]/;

function isKnownToolkitWarning(warning) {
  if (warning.code === 'THIS_IS_UNDEFINED' && warning.id) {
    return actionsPackagePattern.test(warning.id);
  }

  if (warning.code === 'CIRCULAR_DEPENDENCY' && Array.isArray(warning.ids)) {
    return warning.ids.some((id) => actionsPackagePattern.test(id));
  }

  return false;
}

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'es',
    sourcemap: true,
  },
  external: [/^node:/],
  onwarn(warning, warn) {
    if (isKnownToolkitWarning(warning)) {
      return;
    }

    warn(warning);
  },
  plugins: [
    resolve({
      preferBuiltins: true,
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.json',
      noEmit: false,
    }),
  ],
};
