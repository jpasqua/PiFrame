import { cp, mkdir } from "node:fs/promises";

await mkdir("dist/web/static", { recursive: true });
await cp("src/web/static", "dist/web/static", { recursive: true });
