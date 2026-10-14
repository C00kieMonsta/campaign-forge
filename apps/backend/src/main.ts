import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ["error", "warn", "log"],
    // Registered below with a limit instead of Express's default 100 kB: the campaign assistant
    // resends the whole chat and the current draft on every turn, and one long newsletter is past
    // that. 2 MB keeps the zod caps reachable while still bounding a bad client.
    bodyParser: false
  });

  app.setGlobalPrefix("api", { exclude: ["health"] });
  app.enableCors({
    origin: [
      /localhost:\d+$/,
      /127\.0\.0\.1:\d+$/,
      /https:\/\/(.*\.)?moniquepirson\.be$/
    ],
    credentials: true,
    // The chat's "download the cited pièces" button reads the zip's filename off this header, and
    // a cross-origin response hides every header that is not exposed by name.
    exposedHeaders: ["Content-Disposition"]
  });

  // After enableCors on purpose: a body the parser rejects (413, malformed JSON) must still
  // answer with the CORS headers, or the browser reports a network error instead of the status.
  app.useBodyParser("json", { limit: "2mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "2mb" });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(JSON.stringify({ event: "server:started", port }));
}

// A failure here (e.g. bad config, unreachable dependency) must exit cleanly with a
// structured, greppable log and a non-zero code — NOT an unhandled promise rejection.
// Combined with the deploy's blocking health check, this turns a bad boot into a visible,
// failed deploy instead of a silent crash-loop that takes the Campaigns app down.
bootstrap().catch((err) => {
  console.error(
    JSON.stringify({
      level: "fatal",
      event: "server:bootstrap_failed",
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined
    })
  );
  process.exit(1);
});
