// Node-only (dns, net, http). Imported as "@a11yagent/core/net" so the web
// app's client bundle never pulls these modules in through the root index.
export * from "./guardedFetch.js";
export * from "./guardedLookup.js";
export * from "./guardProxy.js";
export * from "./ipRanges.js";
export * from "./ssrfGuard.js";
