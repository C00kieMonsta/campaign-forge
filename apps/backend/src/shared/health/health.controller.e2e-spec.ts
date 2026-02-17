import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { HealthController } from "@/shared/health/health.controller";

describe("HealthController (e2e)", () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController]
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe("GET /health", () => {
    it("should return health status with correct structure", async () => {
      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      // Verify response structure
      expect(response.body).toHaveProperty("status", "ok");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body.timestamp).toBeDefined();

      // Verify timestamp is a valid ISO string
      const timestamp = new Date(response.body.timestamp);
      expect(timestamp.toISOString()).toBe(response.body.timestamp);
    });

    it("should return current timestamp", async () => {
      const beforeRequest = new Date();

      const response = await request(app.getHttpServer())
        .get("/health")
        .expect(200);

      const afterRequest = new Date();
      const responseTime = new Date(response.body.timestamp);

      // Verify timestamp is between request start and end
      expect(responseTime.getTime()).toBeGreaterThanOrEqual(
        beforeRequest.getTime()
      );
      expect(responseTime.getTime()).toBeLessThanOrEqual(
        afterRequest.getTime()
      );
    });

    it("should consistently return ok status", async () => {
      // Test multiple sequential requests to ensure consistency
      for (let i = 0; i < 3; i++) {
        const response = await request(app.getHttpServer())
          .get("/health")
          .expect(200);

        expect(response.body.status).toBe("ok");
        expect(response.body.timestamp).toBeDefined();
      }
    });
  });
});
