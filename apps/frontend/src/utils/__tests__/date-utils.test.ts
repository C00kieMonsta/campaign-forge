import { formatDateSafe, getRelativeTime, toIsoOrNull } from "../date-utils";

describe("Date Utilities", () => {
  describe("toIsoOrNull", () => {
    it("should convert valid Date object to ISO string", () => {
      const date = new Date("2023-01-01T12:00:00.000Z");
      expect(toIsoOrNull(date)).toBe("2023-01-01T12:00:00.000Z");
    });

    it("should convert valid string to ISO string", () => {
      expect(toIsoOrNull("2023-01-01")).toBe("2023-01-01T00:00:00.000Z");
      expect(toIsoOrNull("2023-01-01T12:00:00Z")).toBe(
        "2023-01-01T12:00:00.000Z"
      );
    });

    it("should convert valid number timestamp to ISO string", () => {
      const timestamp = 1672574400000; // 2023-01-01T12:00:00.000Z
      expect(toIsoOrNull(timestamp)).toBe("2023-01-01T12:00:00.000Z");
    });

    it("should return null for invalid values", () => {
      expect(toIsoOrNull(null)).toBeNull();
      expect(toIsoOrNull(undefined)).toBeNull();
      expect(toIsoOrNull("invalid-date")).toBeNull();
      expect(toIsoOrNull(new Date("invalid"))).toBeNull();
      expect(toIsoOrNull({})).toBeNull();
      expect(toIsoOrNull([])).toBeNull();
    });

    it("should handle objects with date-like methods", () => {
      const mockDateObject = {
        toISOString: () => "2023-01-01T12:00:00.000Z"
      };
      expect(toIsoOrNull(mockDateObject)).toBe("2023-01-01T12:00:00.000Z");
    });
  });

  describe("formatDateSafe", () => {
    it("should format valid dates", () => {
      const result = formatDateSafe("2023-01-01T12:00:00.000Z");
      expect(result).toMatch(/Jan 1, 2023/);
    });

    it("should return '--' for invalid dates", () => {
      expect(formatDateSafe(null)).toBe("--");
      expect(formatDateSafe(undefined)).toBe("--");
      expect(formatDateSafe("invalid-date")).toBe("--");
      expect(formatDateSafe({})).toBe("--");
    });

    it("should use custom formatting options", () => {
      const options: Intl.DateTimeFormatOptions = {
        year: "numeric",
        month: "long",
        day: "numeric"
      };
      const result = formatDateSafe("2023-01-01", options);
      expect(result).toMatch(/January 1, 2023/);
    });
  });

  describe("getRelativeTime", () => {
    beforeEach(() => {
      // Mock Date.now to return a fixed timestamp for consistent testing
      jest
        .spyOn(Date, "now")
        .mockReturnValue(new Date("2023-01-01T12:00:00.000Z").getTime());
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("should return 'Just now' for very recent dates", () => {
      const recentDate = new Date("2023-01-01T11:59:30.000Z").toISOString();
      expect(getRelativeTime(recentDate)).toBe("Just now");
    });

    it("should return minutes ago for recent dates", () => {
      const minutesAgo = new Date("2023-01-01T11:45:00.000Z").toISOString();
      expect(getRelativeTime(minutesAgo)).toBe("15m ago");
    });

    it("should return hours ago for dates within 24 hours", () => {
      const hoursAgo = new Date("2023-01-01T08:00:00.000Z").toISOString();
      expect(getRelativeTime(hoursAgo)).toBe("4h ago");
    });

    it("should return days ago for dates within 30 days", () => {
      const daysAgo = new Date("2022-12-29T12:00:00.000Z").toISOString();
      expect(getRelativeTime(daysAgo)).toBe("3d ago");
    });

    it("should return formatted date for older dates", () => {
      const oldDate = new Date("2022-06-01T12:00:00.000Z").toISOString();
      const result = getRelativeTime(oldDate);
      expect(result).toMatch(/Jun 1/);
    });

    it("should return '--' for invalid dates", () => {
      expect(getRelativeTime(null)).toBe("--");
      expect(getRelativeTime(undefined)).toBe("--");
      expect(getRelativeTime("invalid-date")).toBe("--");
    });
  });
});
