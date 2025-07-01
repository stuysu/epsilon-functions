import corsHeaders from '../_shared/cors.ts';
import supabaseAdmin from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const authHeader = req.headers.get('Authorization')!;

    const jwt = authHeader.split(' ')[1];
    const { data: userData } = await supabaseAdmin.auth.getUser(jwt);
    const user = userData.user;

    if (!user) {
        return new Response('Failed to fetch user.', { status: 500 });
    }

    const { data: verifiedUser, error: verifiedUserError } = await supabaseAdmin
        .from('permissions')
        .select('permission,users!inner(id)')
        .eq('users.email', user.email)
        .maybeSingle();

    if (verifiedUserError) {
        console.log(verifiedUserError);
        return new Response(`Failed to fetch user id.`, {
            status: 500,
        });
    }

    if (!verifiedUser) {
        return new Response('User is unauthorized.', { status: 401 });
    }

    if (
        verifiedUser.permission !== 'ADMIN'
    ) {
        return new Response('Permission Denied', { status: 403 });
    }
    const { data: folders, error: folderError } = await supabaseAdmin.storage
        .from('public-files').list('org-pictures/');
    if (folderError || !folders) {
        return new Response('Failed to fetch any organization folders.', {
            status: 400,
        });
    }
    const pictures = [];
    const { data: activePictures, error: activePicturesError } =
        await supabaseAdmin.from('organizations').select('picture');
    if (activePicturesError || !activePictures) {
        return new Response('Failed to fetch active pictures', { status: 400 });
    }
    // remove nulls
    pictures.push(...activePictures.filter((pic) => pic.picture));
    const { data: pendingPictures, error: pendingPicturesError } =
        await supabaseAdmin.from('organizationedits').select('picture');
    if (pendingPicturesError || !pendingPictures) {
        return new Response('Failed to fetch pending pictures', {
            status: 400,
        });
    }
    pictures.push(...pendingPictures.filter((pic) => pic.picture));
    const picture_ids = pictures.map((picture) => {
        const arr = picture.picture.split('/');
        return arr.slice(-2, arr.length);
    });
    const delete_pictures: string[] = [];
    for (let f in folders) {
        const folder = folders[f];
        const { data, error } = await supabaseAdmin.storage.from('public-files')
            .list(`org-pictures/${folder.name}`);
        if (error || !data) {
            return new Response(
                `Failed to fetch organization folder org-pictures/${folder.name}.`,
                { status: 400 },
            );
        }
        const active_pictures = picture_ids.filter((picture) =>
            picture[0] === folder.name
        );
        for (let i in data) {
            if (
                !active_pictures.some((picture) => picture[1] === data[i].name)
            ) {
                delete_pictures.push(
                    `org-pictures/${folder.name}/${data[i].name}`,
                );
            }
        }
    }
    if (delete_pictures.length > 0) {
        const { error: deleteError } = await supabaseAdmin.storage.from(
            'public-files',
        ).remove(delete_pictures);
        if (deleteError) {
            console.log(deleteError);
            return new Response('Failed to delete pictures', { status: 400 });
        }
    }

    return new Response(
        JSON.stringify({
            message: `Deleted ${delete_pictures.length} pictures.`,
        }),
        {
            headers: { 'Content-Type': 'application/json' },
        },
    );
});
