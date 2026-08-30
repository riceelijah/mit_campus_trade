import express, { Request, Response, NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth';
import { adminRouter } from './routes/admin';
import { meRouter } from './routes/me';
import { cardsRouter } from './routes/cards';
import { settingsRouter } from './routes/settings';
import { SESSION_SECRET } from './auth/session';

const app = express();

// The exact "real reverse proxy" case routes/auth.ts's authLimiter comment already warned
// about -- production now sits behind CloudFront, which sets X-Forwarded-For on every request.
// Without this, express-rate-limit refuses to start up its IP-keyed limiters at all (throws
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR the first time a request carries that header, since
// trusting it without being told to would let a client spoof their own rate-limit key). `1`
// trusts exactly one hop in front of the app -- CloudFront -- which is this deployment's actual
// topology; only enabled in production so a local/dev request (no real proxy in front) can't
// spoof its own X-Forwarded-For and bypass rate limiting during testing.
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

app.use(express.json());
app.use(cookieParser(SESSION_SECRET));

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/me', meRouter);
app.use('/api/cards', cardsRouter);
app.use('/api/settings', settingsRouter);

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
