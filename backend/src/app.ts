import express from "express";
import healthRouter from "./modules/health/health.routes.js";
import errorMiddleware from "./middleware/error.middleware";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/", healthRouter);
app.use(errorMiddleware);

export default app;