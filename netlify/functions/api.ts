import serverless from "serverless-http";
import { createApp } from "../../server/src/app";

const app = createApp();
const serverlessHandler = serverless(app);

/**
 * Netlify Function handler wrapping the Express CodeQuest application.
 *
 * Incoming requests matching `/api/*` are rewritten by netlify.toml to
 * `/.netlify/functions/api/:splat`. We normalize the path so Express routes
 * mounted at `/api` match consistently whether invoked directly or via Netlify redirect.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any, context: any) => {
  if (event.path && event.path.startsWith("/.netlify/functions/api")) {
    const subpath = event.path.replace(/^\/\.netlify\/functions\/api/, "");
    event.path = `/api${subpath.startsWith("/") ? subpath : `/${subpath}`}`;
  }
  return serverlessHandler(event, context);
};
