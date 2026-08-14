import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { meRouter } from './routes/me';
import { SESSION_SECRET } from './auth/session';

const app = express();
app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/me', meRouter);

// Catch-all error handler -- must be last, and must declare all 4 params (Express uses the
// arity to recognize it as an error handler). Without this, Express's default handler
// returns an HTML page with the full server stack trace (file paths, dependency internals)
// for anything that throws, e.g. malformed JSON in a request body -- confirmed and closed.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => {
    console.log(`Campus Trade API listening on http://localhost:${PORT}`);
});
