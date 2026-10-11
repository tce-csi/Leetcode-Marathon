import { describe, expect, it } from "vitest";
import { handler } from "../../netlify/functions/api";

describe("Netlify Functions Adapter", () => {
  it("serves GET /api/health with status 200", async () => {
    const event = {
      httpMethod: "GET",
      path: "/api/health",
      headers: {},
      multiValueHeaders: {},
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      body: null,
      isBase64Encoded: false,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await (handler as any)(event, {});
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ ok: true, data: { status: "ok" } });
  });

  it("handles redirected path /.netlify/functions/api/health gracefully", async () => {
    const event = {
      httpMethod: "GET",
      path: "/.netlify/functions/api/health",
      headers: {},
      multiValueHeaders: {},
      queryStringParameters: null,
      multiValueQueryStringParameters: null,
      body: null,
      isBase64Encoded: false,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await (handler as any)(event, {});
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toEqual({ ok: true, data: { status: "ok" } });
  });
});
