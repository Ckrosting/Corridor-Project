/**
 * Asserts that a module is not executing in a browser.
 *
 * The `server-only` package cannot be used for this here: it throws whenever it
 * is loaded outside Next's react-server module graph, which would break the
 * background worker, the CLI scripts and the test suite — all of which are
 * legitimate server-side consumers of the database and service layers.
 *
 * This check is equivalent for the thing that actually matters (never running in
 * a browser) while staying usable from every server runtime.
 */
if (typeof window !== 'undefined') {
  throw new Error(
    'A server-only module was imported into browser code. Database, storage, ' +
      'environment and service modules must never reach the client bundle.',
  );
}

export {};
