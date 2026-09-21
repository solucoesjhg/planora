/**
 * What `server-only` resolves to inside the integration suite.
 *
 * The real package throws when a client bundle reaches a server module, which
 * is the guard we want in the application and a wall in a test runner that has
 * no client at all. `vitest.integration.config.mts` points the specifier here.
 */
export {};
