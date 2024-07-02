import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Transport from '../_shared/emailTransport.ts';
import corsHeaders from '../_shared/cors.ts';
import { datetime } from "https://deno.land/x/ptera/mod.ts";

type BodyType = {
    room_id: number,
    organization_id: number,
    start_time: string,
    end_time: string
}

Deno.serve(async (req : Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    const {
        room_id,
        organization_id,
        start_time,
        end_time
    } : BodyType = await req.json();

    if (!room_id || !organization_id || !start_time || !end_time) {
        return new Response("Missing field", { status: 400 });
    }

    const authHeader = req.headers.get('Authorization')!
    const supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
    );

    const jwt = authHeader.split(" ")[1];
    const { data: userData } = await supabaseClient.auth.getUser(jwt);
    const user = userData.user;

    /* Failed to fetch supabase user */
    if (!user) {
        return new Response("Failed to fetch user.", { status: 500 });
    }

    /* check if user is a verified user. Verified user = the userdata that the site uses */
    const { data: verifiedUsers, error: verifiedUsersError } = await supabaseClient.from('users')
        .select('*')
        .eq('email', user.email);
    
    if (verifiedUsersError) {
        return new Response("Failed to fetch users associated email.", { status: 500 });
    }

    if (!verifiedUsers || !verifiedUsers.length) {
        return new Response("User is unauthorized.", { status: 401 });
    }

    /* validation via RLS */
    
    /* 
    check if there is any interference with time and room.
    if there are any other meetings, kick them out and bcc it@stuysu.org.
    */

    const { data: meetings, error: meetingFetchError } = await supabaseClient
        .rpc("get_booked_rooms", {
            meeting_start: start_time,
            meeting_end: end_time,
        })
        .returns<{ room_id: number, meeting_id: number }[]>();
    
    if (meetingFetchError || !meetings) {
        return new Response("Failed to fetch meetings", { status: 500 });
    }

    const conflictingMeeting = meetings.find(meeting => meeting.room_id === room_id);

    if (conflictingMeeting) {
        await supabaseClient.from('meetings')
            .delete()
            .eq('id', conflictingMeeting.meeting_id)
            .select(`
                title,
                organizations!inner (
                    name,
                    id
                )    
            `)
            .returns<{ title: string, organizations: { name: string, id: number } }[]>()
            .then(({ data: orgData, error: orgError }) => {
                if (orgError || !orgData) {
                    console.error("Failed to fetch org.")
                    return;
                }

                const orgName = orgData[0].organizations.name;
                const orgId = orgData[0].organizations.id;

                type orgAdminType = {
                    id: number,
                    role: 'ADMIN' | 'CREATOR',
                    users: {
                        first_name: string,
                        email: string
                    }
                };

                /* asynchronously email admins to prevent function from hanging on client */
                supabaseClient.from('memberships')
                .select(`
                    id,
                    role,
                    users!inner (
                        first_name,
                        email
                    )
                `)
                .eq('organization_id', orgId)
                .in('role', ['ADMIN', 'CREATOR'])
                .returns<orgAdminType[]>()
                .then(resp => {
                    const { data: orgAdmins, error: orgAdminError } = resp;
                    if (orgAdminError || !orgAdmins || !orgAdmins.length) {
                        console.log("Unable to email org admins.");
                        return;
                    }

                    // so it@stuysu.org also gets updates
                    orgAdmins.push({ id: -1, role: "ADMIN", users: { first_name: "IT DEP", email: "it@stuysu.org" } });

                    for (const admin of orgAdmins) {
                        const emailBody =
            `Hi ${admin.users.first_name}!

Your meeting, ${orgData[0].title}, has been cancelled by admins due to a conflict with another meeting.

We deeply apologize for the inconvenience, and we hope you are able to schedule it to a different room.
The Epsilon Team
`
                
                        /* don't use await here. let this operation perform asynchronously */
                        Transport.sendMail({
                            from: Deno.env.get('NODEMAILER_FROM')!,
                            to: admin.users.email,
                            subject: `Meeting removed for ${orgName} | Epsilon`,
                            text: emailBody,
                        })
                        .catch((error : unknown) => {
                            if (error instanceof Error) {
                                console.error(`Failed to send email: ` + error.message);
                            } else {
                                console.error('Unexpected error', error);
                            }
                        })
                    }
                });

            });
    }

    const { error: reserveError } = await supabaseClient.from('meetings')
        .insert({
                room_id,
                organization_id,
                start_time: datetime(start_time).toISO(),
                end_time: datetime(end_time).toISO(),
                title: "Reserved Meeting",
                description: "This meeting was reserved by an admin."
            });
    
    if (reserveError) {
        return new Response("Failed to reserve room.", { status: 500 });
    }

    return new Response(
        JSON.stringify({
            success: true
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        }
    );
})