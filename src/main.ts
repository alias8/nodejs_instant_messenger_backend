import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WsAdapter } from '@nestjs/platform-ws';
import cookieParser from 'cookie-parser';
import logger from 'morgan';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

// Local dev runs two frontend instances (npm run dev1/dev2) to simulate two
// separate servers, on ports 5173 and 5174 respectively — both need to be allowed.
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:5174'];
const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: CORS_ORIGINS ?? (process.env.NODE_ENV === 'production' ? [] : DEV_ORIGINS),
    credentials: true,
  });
  app.use(logger('dev'));
  app.use(cookieParser(process.env.COOKIE_SECRET ?? 'dev-secret'));
  app.useGlobalFilters(new AllExceptionsFilter());
  // Attaches the ChatGateway's WebSocket server to the same underlying HTTP
  // server, so http and ws traffic share a single port like the original setup.
  app.useWebSocketAdapter(new WsAdapter(app));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Server listening on port ${port}`);
}

bootstrap();
