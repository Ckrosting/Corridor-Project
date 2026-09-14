/**
 * Next ships type declarations for `*.module.css` only, so a plain global
 * stylesheet import (`import './globals.css'`) is otherwise reported as an
 * untyped side-effect import under TypeScript 5.6+.
 */
declare module '*.css';
