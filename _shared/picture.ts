import supabaseAdmin from './supabaseAdmin.ts';

// matches the charter form's 5 MB limit
const MAX_BYTES = 5 * 1024 * 1024;

const ascii = (bytes: Uint8Array, from: number, to: number) =>
    String.fromCharCode(...bytes.subarray(from, to));

/* what the file must start with, so the type can't just be claimed */
const TYPES: Record<
    string,
    { ext: string; matches: (b: Uint8Array) => boolean }
> = {
    'image/png': { ext: 'png', matches: (b) => ascii(b, 1, 4) === 'PNG' },
    'image/jpeg': {
        ext: 'jpg',
        matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    },
    'image/gif': { ext: 'gif', matches: (b) => ascii(b, 0, 4) === 'GIF8' },
    'image/webp': {
        ext: 'webp',
        matches: (b) => ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP',
    },
};

export const PICTURE_PROBLEM =
    'The picture must be a PNG, JPEG, WebP or GIF image of at most 5 MB.';

export type ClubPicture = { bytes: Uint8Array; type: string; ext: string };

/* null when the file isn't an allowed image */
export const readClubPicture = async (
    file: File,
): Promise<ClubPicture | null> => {
    const type = file.type.toLowerCase();
    const info = TYPES[type];
    if (!info || !file.size || file.size > MAX_BYTES) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    return info.matches(bytes) ? { bytes, type, ext: info.ext } : null;
};

/* where visitors load storage files from (functions may reach Supabase on an
   internal address, so SUPABASE_PUBLIC_URL says the public one) */
export const publicBase = () => {
    const base = Deno.env.get('SUPABASE_PUBLIC_URL');
    if (!base) console.warn('[uploadClubPicture] SUPABASE_PUBLIC_URL not set');
    return (base || Deno.env.get('SUPABASE_URL') || '').replace(/\/+$/, '');
};

/* Uploads to public-files/org-pictures/<org id>/ and returns its path and
   public URL, or null when the upload fails. */
export const uploadClubPicture = async (
    orgId: number,
    orgUrl: string,
    picture: ClubPicture,
): Promise<{ path: string; url: string } | null> => {
    const path =
        `org-pictures/${orgId}/${Date.now()}-${orgUrl}-profile.${picture.ext}`;
    const { error } = await supabaseAdmin.storage
        .from('public-files')
        .upload(path, picture.bytes, {
            contentType: picture.type,
            // every upload gets a new name, so browsers can keep it for a year
            cacheControl: '31536000',
        });
    if (error) {
        console.error('[uploadClubPicture] failed', error);
        return null;
    }
    return {
        path,
        url: `${publicBase()}/storage/v1/object/public/public-files/${path}`,
    };
};

/* Deletes a picture uploadClubPicture made for this club; other URLs are left
   alone. */
export const removeClubPicture = async (orgId: number, url?: string | null) => {
    const path = url?.split('/storage/v1/object/public/public-files/')[1];
    if (!path?.startsWith(`org-pictures/${orgId}/`)) return;
    const { error } = await supabaseAdmin.storage.from('public-files')
        .remove([decodeURIComponent(path)]);
    if (error) console.error('[removeClubPicture] failed', error.message);
};

const PAGE = 1000;

/* Deletes everything under org-pictures/<org id>/, subfolders too, e.g. once
   its club is gone. */
export const removeClubFolder = async (orgId: number) => {
    const bucket = supabaseAdmin.storage.from('public-files');
    const files: string[] = [];
    const folders = [`org-pictures/${orgId}`];
    for (let folder = folders.pop(); folder; folder = folders.pop()) {
        for (let offset = 0;; offset += PAGE) {
            const { data, error } = await bucket.list(folder, {
                limit: PAGE,
                offset,
            });
            if (error) {
                console.error('[removeClubFolder] list failed', error.message);
                return;
            }
            for (const entry of data ?? []) {
                // folders have no id
                (entry.id ? files : folders).push(`${folder}/${entry.name}`);
            }
            if ((data?.length ?? 0) < PAGE) break;
        }
    }
    for (let i = 0; i < files.length; i += PAGE) {
        const { error } = await bucket.remove(files.slice(i, i + PAGE));
        if (error) console.error('[removeClubFolder] failed', error.message);
    }
};
