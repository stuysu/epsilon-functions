import { google } from 'npm:googleapis';
import supabaseAdmin from '../supabaseAdmin.ts';

const auth = new google.auth.OAuth2(
    Deno.env.get('GOOGLE_CLIENT_ID')!,
    Deno.env.get('GOOGLE_CLIENT_SECRET')!,
    'urn:ietf:wg:oauth:2.0:oob',
);

const setupOauth = async () => {
    console.log('[Setting up OAuth2]');
    console.log(`Client ID: ${Deno.env.get('GOOGLE_CLIENT_ID')}`);
    console.log(`Client Secret: ${Deno.env.get('GOOGLE_CLIENT_SECRET')}`);

    const { data: response, error: tokenError } = await supabaseAdmin.from(
        'backgroundtokens',
    )
        .select('tokens')
        .eq('service', 'google');

    if (!response || tokenError) {
        throw new Error('Failed to fetch token');
    }

    const tokenData = response[0];

    if (!tokenData || !tokenData.tokens) {
        throw new Error(
            'You haven\'t yet authenticated with google. Do that first by running: npm run authenticate',
        );
    }

    const tokens = JSON.parse(tokenData.tokens);
    auth.setCredentials(tokens);
    console.log('[Finished setting up OAuth2]');
};

/* FAKE API CALLS: no idea if they're necessary, but they were used in StuyActivities 2.0 */
let accessToken = '';

const fakeApiCall = async () => {
    await setupOauth();

    const calendar = google.calendar({ version: 'v3' });
    await calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime',
        auth,
    });

    if (accessToken !== auth.credentials.access_token) {
        console.log('Access token has been refreshed ' + new Date());

        const { error } = await supabaseAdmin.from('backgroundtokens')
            .update({ tokens: JSON.stringify(auth.credentials) })
            .eq('service', 'google');

        if (error) {
            console.error('Error updating access token: ' + error.message);
        }

        accessToken = auth.credentials.access_token;
    }
};

fakeApiCall();

setInterval(fakeApiCall, 1000 * 60); // 1 minute

export default auth;
