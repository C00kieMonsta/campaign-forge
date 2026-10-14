import { downscaleImage, jpegName, targetSize } from "../imageDownscale";

describe("targetSize", () => {
  it("leaves an image within the cap untouched", () => {
    expect(targetSize(1200, 800, 1600)).toEqual({ width: 1200, height: 800 });
    expect(targetSize(1600, 900, 1600)).toEqual({ width: 1600, height: 900 });
  });

  it("scales a landscape photo down to the cap on its width", () => {
    expect(targetSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait photo down to the cap on its height", () => {
    expect(targetSize(3024, 4032, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it("rounds to whole pixels and never produces a zero edge", () => {
    expect(targetSize(1601, 1000, 1600)).toEqual({ width: 1600, height: 999 });
    expect(targetSize(10000, 1, 1600)).toEqual({ width: 1600, height: 1 });
  });

  it("never upscales a small image", () => {
    expect(targetSize(320, 240, 1600)).toEqual({ width: 320, height: 240 });
  });

  it("passes degenerate sizes through for the caller to fail on", () => {
    expect(targetSize(0, 0, 1600)).toEqual({ width: 0, height: 0 });
    expect(targetSize(4000, 3000, 0)).toEqual({ width: 4000, height: 3000 });
  });
});

describe("jpegName", () => {
  it("swaps the extension for .jpg", () => {
    expect(jpegName("IMG_0042.HEIC")).toBe("IMG_0042.jpg");
    expect(jpegName("card.png")).toBe("card.jpg");
  });

  it("appends .jpg when there is no extension", () => {
    expect(jpegName("image")).toBe("image.jpg");
  });

  it("keeps dots that are part of the name", () => {
    expect(jpegName("marie.dupont.card.jpeg")).toBe("marie.dupont.card.jpg");
  });

  it("falls back to a name when the original is only an extension", () => {
    expect(jpegName(".heic")).toBe("photo.jpg");
  });
});

describe("downscaleImage when nothing can decode the file", () => {
  const RealImage = globalThis.Image;
  const realCreate = URL.createObjectURL;
  const realRevoke = URL.revokeObjectURL;

  beforeEach(() => {
    // jsdom never loads an image, so this stand-in fails every decode on the next tick.
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        setTimeout(() => this.onerror?.(), 0);
      }
    }
    (globalThis as any).Image = FailingImage;
    URL.createObjectURL = jest.fn(() => "blob:test");
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    globalThis.Image = RealImage;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  });

  it("rejects a type the server could not read either", async () => {
    const heic = new File(["x"], "IMG_0042.HEIC", { type: "image/heic" });
    await expect(downscaleImage(heic)).rejects.toThrow("undecodable");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });

  it("hands a JPEG over untouched so the server can still try", async () => {
    const jpeg = new File(["x"], "card.jpg", { type: "image/jpeg" });
    await expect(downscaleImage(jpeg)).resolves.toBe(jpeg);
  });
});
