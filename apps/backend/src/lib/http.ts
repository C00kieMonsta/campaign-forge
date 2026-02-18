import type { APIGatewayProxyResultV2 } from "aws-lambda";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

export function json(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", ...CORS },
    body: JSON.stringify(body),
  };
}

export function htmlResponse(status: number, body: string): APIGatewayProxyResultV2 {
  return { statusCode: status, headers: { "Content-Type": "text/html; charset=utf-8" }, body };
}

export function csvResponse(body: string, filename: string): APIGatewayProxyResultV2 {
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="${filename}"`, ...CORS },
    body,
  };
}

export const ok = (body: unknown) => json(200, body);
export const created = (body: unknown) => json(201, body);
export const badRequest = (error: string) => json(400, { ok: false, error });
export const notFound = (error = "Not found") => json(404, { ok: false, error });
export const forbidden = () => json(403, { ok: false, error: "Forbidden" });
export const serverError = (error = "Internal server error") => json(500, { ok: false, error });
