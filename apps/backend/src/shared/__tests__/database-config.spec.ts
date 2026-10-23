import { Client } from "pg";
import { databaseConfig } from "../database-config";

describe("database TLS configuration", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const remote = "postgresql://user:password@db.example.com:5432/lex";

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  it("verifies certificates with the bundled RDS CAs by default", () => {
    const config = databaseConfig(remote);
    expect(config.ssl).toEqual({
      rejectUnauthorized: true,
      ca: expect.stringContaining("-----BEGIN CERTIFICATE-----")
    });
  });

  it.each(["disable", "no-verify", "require", "prefer"])(
    "prevents sslmode=%s in the URL from replacing certificate verification",
    (sslmode) => {
      const config = databaseConfig(
        `${remote}?sslmode=${sslmode}&ssl=false&sslrootcert=/missing&sslcert=/missing&sslkey=/missing&sslnegotiation=direct&uselibpqcompat=true&application_name=lex`
      );
      expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
      expect(config.connectionString).not.toMatch(/ssl/);
      expect(config.connectionString).toContain("application_name=lex");
      expect(new Client(config).ssl).toMatchObject({
        rejectUnauthorized: true,
        ca: expect.stringContaining("-----BEGIN CERTIFICATE-----")
      });
    }
  );

  it("allows plaintext only for an explicit local development connection", () => {
    process.env.NODE_ENV = "development";
    expect(
      databaseConfig("postgresql://localhost/lex", { ssl: "false" }).ssl
    ).toBe(false);
    expect(() => databaseConfig(remote, { ssl: "false" })).toThrow(
      "local development"
    );
    expect(() =>
      databaseConfig("postgresql://localhost/lex?host=db.example.com", {
        ssl: "false"
      })
    ).toThrow("local development");
    process.env.NODE_ENV = "production";
    expect(() =>
      databaseConfig("postgresql://localhost/lex", { ssl: "false" })
    ).toThrow("local development");
  });

  it("fails closed if the selected CA file cannot be read", () => {
    expect(() =>
      databaseConfig(remote, { caFile: "/missing/ca.pem" })
    ).toThrow();
  });

  it("rejects unsupported protocols and invalid TLS settings", () => {
    expect(() => databaseConfig("https://db.example.com/lex")).toThrow(
      "postgres"
    );
    expect(() => databaseConfig(remote, { ssl: "no" })).toThrow(
      "true or false"
    );
  });
});
