/**
 * Test stub for the `server-only` package.
 *
 * The real package throws whenever it is loaded outside Next's react-server
 * module graph, which would make the modules that legitimately use it
 * (`lib/auth/guards.ts`, `lib/api.ts`) untestable. Production code keeps the real
 * guard; only the test runner substitutes this no-op.
 */
export {};
