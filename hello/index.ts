// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

import { serve } from 'https://deno.land/std@0.177.1/http/server.ts';
import Transport from '../_shared/emailTransport.ts';

serve(async () => {
    await Transport.sendMail({
                from: Deno.env.get('NODEMAILER_FROM')!,
                to: "rsim40@stuy.edu",
                subject: `TEST EMAIL`,
                text: "Test email to randy sim",
            })
                .catch((error: unknown) => {
                    if (error instanceof Error) {
                        console.error(`Failed to send email: ` + error.message);
                    } else {
                        console.error('Unexpected error', error);
                    }
                });
    
    return new Response(
        `"Hello from Edge Functions! (edited)"`,
        { headers: { 'Content-Type': 'application/json' } },
    );
});

// To invoke:
// curl 'http://localhost:<KONG_HTTP_PORT>/functions/v1/hello' \
//   --header 'Authorization: Bearer <anon/service_role API key>'
