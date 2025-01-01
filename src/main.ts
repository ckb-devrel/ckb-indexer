import { loadConfig } from "@app/commons";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleRoot(req: any, res: any, next: any) {
  if (req.url === "/") {
    return res.send("OK!");
  }

  next();
}

async function bootstrap() {
  const config = loadConfig();

  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.use(handleRoot);
  app.enableCors({
    origin: "*",
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    credentials: true,
  });
  const swaggerConfig = new DocumentBuilder()
    .setTitle("CKB Indexer API")
    .setDescription("The CKB Indexer API description")
    .setVersion("0.0.1")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("docs", app, document);

  await app.listen(config.port, () =>
    Logger.log(`listening on ${config.port}`),
  );
}
bootstrap();
