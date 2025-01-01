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
    .setTitle("Cats example")
    .setDescription("The cats API description")
    .setVersion("1.0")
    .addTag("cats")
    .build();
  const documentFactory = () =>
    SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup("api", app, documentFactory);

  await app.listen(config.port, () =>
    Logger.log(`listening on ${config.port}`),
  );
}
bootstrap();
