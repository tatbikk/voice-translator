// Replacement for the "server-only" package in Vitest and in the esbuild
// bundles of the worker and CLI, which run in plain Node where the real package
// would throw. Next.js keeps using the real package.
export {};
