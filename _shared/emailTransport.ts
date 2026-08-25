import nodemailer from 'nodemailer';

const transport = nodemailer.createTransport({
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
});

export default transport;
