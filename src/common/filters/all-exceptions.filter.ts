import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';

// Mirrors the original Express error handler's `{ error: message }` response
// shape so the frontend contract doesn't change during the migration.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      response
        .status(status)
        .json({ error: Array.isArray(message) ? message.join(', ') : message });
      return;
    }

    console.error(exception);
    response.status(500).json({ error: 'Internal server error' });
  }
}
