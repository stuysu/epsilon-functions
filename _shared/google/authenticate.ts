/*
run this with settings
GOOGLE_CLIENT_ID=<> GOOGLE_CLIENT_SECRET=<> SUPABASE_URL=http://localhost:8000 SUPABASE_SERVICE_ROLE_KEY=<> API_EXTERNAL_URL=<> deno run --allow-net --allow-env --allow-read --unstable authenticate.ts
*/

import { Application, Context, Router } from 'https://deno.land/x/oak/mod.ts';
import { config } from 'https://deno.land/x/dotenv/mod.ts';
import { OAuth2Client } from 'npm:google-auth-library';
import supabaseAdmin from '../supabaseAdmin.ts';

// Load environment variables
config({ export: true });

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;
const PORT = 3001;
const urlElements = Deno.env.get('API_EXTERNAL_URL')!.split(':');
const domain = urlElements[0] + ':' + urlElements[1];
const REDIRECT_URI = `${domain}:${PORT}`;

const oauth2Client = new OAuth2Client(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    REDIRECT_URI,
);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const app = new Application();
const router = new Router();

const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
});

console.log('Viist this URL:', authUrl);

router.get('/', async (context: Context) => {
    const queryParams = context.request.url.searchParams;
    const code = queryParams.get('code');

    if (!code) {
        context.response.status = 400;
        context.response.body = 'No code provided';
        return;
    }

    try {
        const { tokens } = await oauth2Client.getToken(code);

        if (!tokens) {
            context.response.status = 400;
            context.response.body = 'No tokens obtained';
            return;
        }

        const { error } = await supabaseAdmin.from('backgroundtokens')
            .update({ tokens: JSON.stringify(tokens) })
            .eq('service', 'google');

        if (error) {
            console.error(error);
        }

        console.log('Tokens updated!');

        context.response.body =
            'Refresh token obtained. Check the server logs.';
    } catch (error) {
        context.response.status = 500;
        context.response.body =
            `Error obtaining refresh token: ${error.message}`;
    }
});

app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Server running on ${domain}:${PORT}`);
await app.listen({ port: PORT });
