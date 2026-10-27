import { createLogger } from "@a11yagent/core";
import { DEFAULT_PORT, SITE_DIR, startFixtureServer } from "./server.js";

const log = createLogger({ base: { service: "fixtures" } });
const port = Number(process.env.PORT ?? DEFAULT_PORT);

const server = await startFixtureServer(port);
log.info("Bad Bakery fixture site is up", { url: `http://127.0.0.1:${port}`, root: SITE_DIR });

const stop = (): void => {
  server.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
