import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/server/auth/config";

// The auth instance is built on first request, so a build never needs a database.
const handler = (request: Request) => getAuth().handler(request);

export const { GET, POST } = toNextJsHandler(handler);
