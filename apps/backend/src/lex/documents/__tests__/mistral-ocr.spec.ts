import type { ConfigService } from "../../../config/config.service";
import { MistralOcrService } from "../mistral-ocr.service";

/** Records the backoff instead of sleeping it, so the retry path is asserted in milliseconds. */
class TestOcrService extends MistralOcrService {
  readonly delays: number[] = [];

  protected sleep(ms: number): Promise<void> {
    this.delays.push(ms);
    return Promise.resolve();
  }
}

function configWith(apiKey: string | undefined): ConfigService {
  return {
    get: (key: string) =>
      key === "MISTRAL_API_KEY" ? apiKey : "mistral-ocr-latest"
  } as unknown as ConfigService;
}

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  };
}

const OK_BODY = { pages: [{ markdown: "Page one" }, { text: "Page two" }] };
// The exact upstream blip that permanently failed a document during the first bundle upload.
const SERVICE_UNAVAILABLE = { message: "Service unavailable.", code: "3700" };

describe("MistralOcrService retries", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  let service: TestOcrService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new TestOcrService(configWith("test-key"));
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  const run = () =>
    service.ocr(Buffer.from("scan"), "application/pdf", "scan.pdf");

  it("retries a 500 and returns the pages from the successful attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(500, SERVICE_UNAVAILABLE))
      .mockResolvedValueOnce(respond(200, OK_BODY));

    await expect(run()).resolves.toEqual(["Page one", "Page two"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(service.delays).toEqual([1000]);
  });

  it("retries a 429 rate limit", async () => {
    fetchMock
      .mockResolvedValueOnce(respond(429, "slow down"))
      .mockResolvedValueOnce(respond(200, OK_BODY));

    await expect(run()).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a transport failure (reset socket, DNS, timeout)", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("fetch failed"))
      .mockResolvedValueOnce(respond(200, OK_BODY));

    await expect(run()).resolves.toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a 4xx that is our own fault, and says so plainly", async () => {
    fetchMock.mockResolvedValue(respond(400, "unsupported file"));

    await expect(run()).rejects.toThrow(/^Mistral OCR failed: 400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(service.delays).toEqual([]);
  });

  it("gives up after three attempts with backoff, and the error says it was retried", async () => {
    fetchMock.mockResolvedValue(respond(503, SERVICE_UNAVAILABLE));

    await expect(run()).rejects.toThrow(
      /Mistral OCR failed after 3 attempts: 503/
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(service.delays).toEqual([1000, 3000]);
  });

  it("treats a 200 with an unreadable body as transient", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected end of JSON input");
        },
        text: async () => ""
      })
      .mockResolvedValueOnce(respond(200, OK_BODY));

    await expect(run()).resolves.toHaveLength(2);
    expect(service.delays).toEqual([1000]);
  });

  it("fails fast and without a request when no API key is configured", async () => {
    const unconfigured = new TestOcrService(configWith(undefined));
    expect(unconfigured.isConfigured()).toBe(false);
    await expect(
      unconfigured.ocr(Buffer.from("scan"), "application/pdf", "scan.pdf")
    ).rejects.toThrow(/MISTRAL_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops empty pages from the OCR result", async () => {
    fetchMock.mockResolvedValue(
      respond(200, { pages: [{ markdown: "  " }, { markdown: "Real text" }] })
    );
    await expect(run()).resolves.toEqual(["Real text"]);
  });
});
