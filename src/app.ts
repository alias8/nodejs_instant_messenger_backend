import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import logger from 'morgan';
import cookieParser from 'cookie-parser';
import createError, { HttpError } from 'http-errors';

import usersRouter from './routes/users';
import usersConversationsRouter from './routes/conversations';
import mediaRouter from './routes/media';
import searchRouter from './routes/search';

export const app = express();

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? 'https://www.messenger.com'
    : 'http://localhost:5173',
  credentials: true,
}));
app.use(logger('dev'));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET ?? 'dev-secret'));

app.use('/users', usersRouter);
app.use('/conversations', usersConversationsRouter);
app.use('/media', mediaRouter);
app.use('/search', searchRouter);

// 404 handler
app.use((req: Request, res: Response, next: NextFunction) => {
  next(createError(404));
});

// error handler
app.use((err: HttpError, req: Request, res: Response, next: NextFunction) => {
  res.status(err.status || 500).json({ error: err.message });
});

export default app;
