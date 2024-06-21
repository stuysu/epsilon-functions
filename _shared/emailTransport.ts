import nodemailer from 'npm:nodemailer@6.9.10'

const Transport = nodemailer.createTransport({
    host: Deno.env.get('NODEMAILER_HOST')!,
    port: Number(Deno.env.get('NODEMAILER_PORT')!),
    secure: Boolean(Deno.env.get('NODEMAILER_SECURE')!),
    auth: {
        user: Deno.env.get('NODEMAILER_EMAIL')!,
        pass: Deno.env.get('NODEMAILER_PASSWORD')!
    },
    connectionTimeout: 5000,
    socketTimeout: 5000,
    greetingTimeout: 5000
});

export default Transport;