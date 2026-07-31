import { formatDuration, MAX_RECORDING_SECONDS } from "../use-voice-recorder";

describe("formatDuration", () => {
  it("pads the seconds so the timer does not jitter in width", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9)).toBe("0:09");
    expect(formatDuration(59)).toBe("0:59");
  });

  it("rolls over into minutes", () => {
    expect(formatDuration(60)).toBe("1:00");
    expect(formatDuration(61)).toBe("1:01");
    expect(formatDuration(125)).toBe("2:05");
  });

  it("lets minutes grow past an hour rather than adding an hours field", () => {
    expect(formatDuration(3600)).toBe("60:00");
    expect(formatDuration(MAX_RECORDING_SECONDS)).toBe("30:00");
  });

  it("floors fractional seconds", () => {
    expect(formatDuration(59.9)).toBe("0:59");
  });
});
