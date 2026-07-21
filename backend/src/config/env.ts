import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
    PORT: z.coerce.number().default(3000),

    NODE_ENV: z
        .enum(["development", "production", "test"])
        .default("development"),

    POSTGRES_HOST: z.string(),
    POSTGRES_PORT: z.coerce.number(),
    POSTGRES_USER: z.string(),
    POSTGRES_PASSWORD: z.string(),
    POSTGRES_DB: z.string(),

    MONGO_URI: z.string(),
    REDIS_URL: z.string(),

    JWT_SECRET: z.string().min(1),
    JWT_EXPIRES_IN: z.string(),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
    console.error(" Invalid environment configuration");
    console.error(parsedEnv.error.format());
    process.exit(1);
}

 const env = parsedEnv.data;

const config = {
    server: {
        port: env.PORT,
        nodeEnv: env.NODE_ENV
    },

    database: {
        postgres: {
            host: env.POSTGRES_HOST,
            port: env.POSTGRES_PORT,
            user: env.POSTGRES_USER,
            password: env.POSTGRES_PASSWORD,
            database: env.POSTGRES_DB
        },

        mongo: {
            uri: env.MONGO_URI
        }
    },

    redis: {
        url: env.REDIS_URL
    },

    jwt: {
        secret: env.JWT_SECRET,
        expiresIn: env.JWT_EXPIRES_IN
    }
};

export default config;