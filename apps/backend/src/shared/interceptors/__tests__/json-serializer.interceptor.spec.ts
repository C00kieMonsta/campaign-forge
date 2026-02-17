import { CallHandler, ExecutionContext } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { of } from "rxjs";
import { JsonSerializerInterceptor } from "@/shared/interceptors/json-serializer.interceptor";

describe("JsonSerializerInterceptor", () => {
  let interceptor: JsonSerializerInterceptor;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JsonSerializerInterceptor]
    }).compile();

    interceptor = module.get<JsonSerializerInterceptor>(
      JsonSerializerInterceptor
    );
  });

  it("should be defined", () => {
    expect(interceptor).toBeDefined();
  });

  it("should convert BigInt to string", (done) => {
    const mockExecutionContext = {} as ExecutionContext;
    const mockCallHandler: CallHandler = {
      handle: () => of({ id: BigInt(123), name: "test" })
    };

    const result$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler
    );

    result$.subscribe((data) => {
      expect(data.id).toBe("123");
      expect(data.name).toBe("test");
      done();
    });
  });

  it("should convert nested BigInt values", (done) => {
    const mockExecutionContext = {} as ExecutionContext;
    const testData = {
      user: {
        id: BigInt(456),
        organizationId: BigInt(789)
      },
      metadata: {
        count: BigInt(100),
        timestamp: new Date("2023-01-01")
      },
      items: [
        { id: BigInt(1), value: "first" },
        { id: BigInt(2), value: "second" }
      ]
    };

    const mockCallHandler: CallHandler = {
      handle: () => of(testData)
    };

    const result$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler
    );

    result$.subscribe((data) => {
      expect(data.user.id).toBe("456");
      expect(data.user.organizationId).toBe("789");
      expect(data.metadata.count).toBe("100");
      expect(data.metadata.timestamp).toBe("2023-01-01T00:00:00.000Z");
      expect(data.items[0].id).toBe("1");
      expect(data.items[1].id).toBe("2");
      done();
    });
  });

  it("should handle arrays with BigInt values", (done) => {
    const mockExecutionContext = {} as ExecutionContext;
    const testData = [
      { id: BigInt(1) },
      { id: BigInt(2) },
      { nested: { count: BigInt(999) } }
    ];

    const mockCallHandler: CallHandler = {
      handle: () => of(testData)
    };

    const result$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler
    );

    result$.subscribe((data) => {
      expect(data[0].id).toBe("1");
      expect(data[1].id).toBe("2");
      expect(data[2].nested.count).toBe("999");
      done();
    });
  });

  it("should handle null and undefined values", (done) => {
    const mockExecutionContext = {} as ExecutionContext;
    const testData = {
      nullValue: null,
      undefinedValue: undefined,
      bigintValue: BigInt(42)
    };

    const mockCallHandler: CallHandler = {
      handle: () => of(testData)
    };

    const result$ = interceptor.intercept(
      mockExecutionContext,
      mockCallHandler
    );

    result$.subscribe((data) => {
      expect(data.nullValue).toBeNull();
      expect(data.undefinedValue).toBeUndefined();
      expect(data.bigintValue).toBe("42");
      done();
    });
  });
});
