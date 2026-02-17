// Load environment variables from .env file before anything else
// This must be at the very top, before any other imports that might use process.env
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { WsAdapter } from "@nestjs/platform-ws";
import { AppModule } from "@/app.module";

async function bootstrap() {
  try {
    // Suppress NestJS built-in logger - we use Winston instead
    const app = await NestFactory.create(AppModule, {
      logger: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
    });

    // Set global prefix for API routes
    app.setGlobalPrefix("api");

    // Enable CORS with explicit configuration
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const allowedOrigins = [
      frontendUrl,
      "http://localhost:3000",
      "http://localhost:3002",
      "http://localhost:8000",
      "https://remorai.solutions",
      "https://landing.remorai.solutions",
      "https://www.remorai.solutions",
    ];
    
    app.enableCors({
      origin: allowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Requested-With",
        "Accept",
        "Origin",
        "Cache-Control",
        "X-Client-Info",
        "apikey"
      ],
      exposedHeaders: ["Content-Range", "X-Content-Range"],
      maxAge: 3600 // Cache preflight for 1 hour
    });

    console.log(
      JSON.stringify({
        level: "info",
        action: "corsConfigured",
        allowedOrigins,
        message: "CORS enabled for multiple origins"
      })
    );

    // Enable WebSocket support
    app.useWebSocketAdapter(new WsAdapter(app));

    const port = process.env.PORT || 8001;
    await app.listen(port);
    console.log(
      JSON.stringify({
        level: "info",
        action: "applicationStarted",
        port: port,
        message: "Application is running"
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        action: "bootstrapFailed",
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined
      })
    );
    process.exit(1);
  }
}

bootstrap().catch((error) => {
  console.error(
    JSON.stringify({
      level: "error",
      action: "bootstrapUnhandled",
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined
    })
  );
  process.exit(1);
});
