import nodemailer from 'nodemailer';

const options = {
    host: Deno.env.get('NODEMAILER_HOST')!,
    port: Number(Deno.env.get('NODEMAILER_PORT')!),
    secure: Deno.env.get('NODEMAILER_SECURE')! === 'true',
    auth: {
        user: Deno.env.get('NODEMAILER_EMAIL')!,
        pass: Deno.env.get('NODEMAILER_PASSWORD')!,
    },
    connectionTimeout: 5000,
    socketTimeout: 5000,
    greetingTimeout: 5000,
};

const Transport = nodemailer.createTransport(options);

export type PooledTransport = {
    sendMail: typeof Transport.sendMail;
    close: () => void;
};

/* reuses a few connections for many messages; close() it when done */
export const pooledTransport = (maxConnections = 5): PooledTransport =>
    nodemailer.createTransport({
        ...options,
        pool: true,
        maxConnections,
        maxMessages: 200,
    });

export default Transport;
