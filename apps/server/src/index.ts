import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const app = await buildApp({ allowedOrigin: process.env.ALLOWED_ORIGIN });
await app.listen({ port, host: "0.0.0.0" });
console.log(`GD Arena server listening on :${port}`);
