import { jpegName, targetSize } from "../imageDownscale";

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
