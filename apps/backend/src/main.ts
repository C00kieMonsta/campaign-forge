import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["error", "warn", "log"] });

  app.setGlobalPrefix("api");
  app.enableCors({
    origin: [/localhost:\d+$/, /127\.0\.0\.1:\d+$/, /https:\/\/.*\.moniquepirson\.be$/],
    credentials: true,
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(JSON.stringify({ event: "server:started", port }));
}

bootstrap();
