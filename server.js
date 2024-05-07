import express from 'express';
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createProxyMiddleware } from "http-proxy-middleware";
import { services } from "./services/services.js";
import 'dotenv/config';

const app = express();
const port = 3000 || process.env.PORT;

app.use(cors({ origin: "*" }));
app.use(helmet());
app.use(morgan("combined"));
app.use(express.json());

// jwt authentication
app.post('/login', (req, res) => {
    const username = req.body.username;
    const user = { name: username };

    const accessToken = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
    const refreshToken = jwt.sign(user, process.env.REFRESH_TOKEN_SECRET);

    res.json({ accessToken: accessToken, refreshToken: refreshToken });
});


let refreshTokens = [];
app.post('/token', (req, res) => {
    const refreshToken = req.body.token;
    if (refreshToken == null) return res.sendStatus(401);
    if (!refreshTokens.includes(refreshToken)) return res.sendStatus(403);

    jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        const accessToken = jwt.sign({ name: user.name }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '15m' });
        res.json({ accessToken: accessToken });
    });
});

app.delete('/logout', (req, res) => {
    refreshTokens = refreshTokens.filter(token => token !== req.body.token);
    res.sendStatus(204);
});

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401);

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

const rateLimit = process.env.RATELIMIT;
const rateLimitInterval = process.env.RATELIMIT_WINDOW;

const requestCount = {};

setInterval(() => {
    Object.keys(requestCount).forEach((ip) => {
        requestCount[ip] = 0;
    });
}, rateLimitInterval);

const rateLimiter = (req, res, next) => {
    const ip = req.ip;
    requestCount[ip] = requestCount[ip] ? requestCount[ip] + 1 : 1;

    if (requestCount[ip] > rateLimit) {
        return res.status(429).json({
            code: 429,
            status: "Error",
            message: "Rate limit exceeded.",
            data: null,
        });
    }

    req.setTimeout(15000, () => {
        res.status(504).json({
            code: 504,
            status: "Error",
            message: "Gateway timeout.",
            data: null,
        });
        req.abort();
    });

    next();
}

app.use(rateLimiter);

services.forEach(({ route, target }) => {
    const proxyOptions = {
        target,
        changeOrigin: true,
        pathRewrite: {
            [`^${route}`]: "",
        },
    };

    app.use(route, rateLimiter, createProxyMiddleware(proxyOptions));
});

app.use((_req, res) => {
    res.status(404).json({
        code: 404,
        status: "Error",
        message: "Route not found.",
        data: null,
    });
});

app.listen(port, () => {
    console.log(`Gateway running on http://localhost:${port}`);
});