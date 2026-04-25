import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
// Load environment variables from .env if present
import * as dotenv from 'dotenv';
dotenv.config();

async function bootstrap() {
  const port = Number(process.env.TIME_OFF_PORT || process.env.PORT || 3000);
  const app = await NestFactory.create(AppModule);
  await app.listen(port);
}
bootstrap();
