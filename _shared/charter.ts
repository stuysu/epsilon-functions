type Rule = {
    label: string;
    required?: boolean;
    minChar?: number;
    maxChar?: number;
    minWords?: number;
    maxWords?: number;
    pattern?: RegExp;
    patternMessage?: string;
};

const RULES: { [field: string]: Rule } = {
    name: {
        label: 'Name',
        required: true,
        minChar: 3,
        maxChar: 60,
        pattern: /^[a-z0-9\- ]+$/i,
        patternMessage: 'can only have letters, numbers, spaces and dashes',
    },
    url: {
        label: 'URL',
        required: true,
        minChar: 3,
        maxChar: 40,
        pattern: /^[a-z0-9-]+$/,
        patternMessage: 'can only have lowercase letters, numbers and dashes',
    },
    socials: { label: 'Socials', maxChar: 2500 },
    mission: {
        label: 'Mission',
        required: true,
        minWords: 75,
        maxWords: 800,
    },
    goals: { label: 'Goals', required: true, minWords: 75, maxWords: 600 },
    purpose: { label: 'Purpose', required: true, minWords: 50, maxWords: 300 },
    appointment_procedures: {
        label: 'Appointment procedures',
        required: true,
        minWords: 50,
        maxWords: 200,
    },
    uniqueness: {
        label: 'Uniqueness',
        required: true,
        minWords: 50,
        maxWords: 800,
    },
    meeting_description: {
        label: 'Meeting description',
        required: true,
        minWords: 150,
        maxWords: 500,
    },
    meeting_schedule: {
        label: 'Meeting schedule',
        required: true,
        minWords: 50,
        maxWords: 600,
    },
    returning_info: {
        label: 'Returning information',
        minWords: 75,
        maxWords: 600,
    },
    faculty_email: { label: 'Faculty email', minChar: 10, maxChar: 64 },
};

const COMMITMENT_LEVELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH'];
const MAX_TAGS = 3;
const MAX_KEYWORDS = 3;

const stripWhitespace = (value: string) =>
    value.replace(/[ \t]+$/gm, '').trim();

/* people usually leave off the https://, so only check it when it's there */
const isWebLink = (value: string) => {
    try {
        const { protocol, hostname, username, password } = new URL(
            /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`,
        );
        return (protocol === 'http:' || protocol === 'https:') &&
            !username && !password && !value.endsWith(',') &&
            /\.[a-z][a-z0-9-]+$/.test(hostname);
    } catch {
        return false;
    }
};

/* kept in sync with LINK_TYPES in the site's src/utils/SocialLinks.ts */
const LINK_TYPES: Record<string, { label: string; hosts?: string[] }> = {
    website: { label: 'Website' },
    instagram: { label: 'Instagram', hosts: ['instagram.com'] },
    tiktok: { label: 'TikTok', hosts: ['tiktok.com'] },
    linktree: { label: 'Linktree', hosts: ['linktr.ee'] },
    discord: { label: 'Discord', hosts: ['discord.gg', 'discord.com'] },
    youtube: { label: 'YouTube', hosts: ['youtube.com', 'youtu.be'] },
    x: { label: 'X (Twitter)', hosts: ['x.com', 'twitter.com'] },
    facebook: { label: 'Facebook', hosts: ['facebook.com', 'fb.com'] },
    linkedin: { label: 'LinkedIn', hosts: ['linkedin.com'] },
    github: { label: 'GitHub', hosts: ['github.com'] },
    form: {
        label: 'Sign-up Form',
        hosts: ['forms.gle', 'docs.google.com', 'forms.office.com'],
    },
    other: { label: 'Other' },
};

/* socials is a JSON list of {type, url, name}; older charters have links
   separated by spaces */
const socialsProblems = (socials: string): string[] => {
    const text = socials.trim();
    if (!text.startsWith('[')) {
        const invalid = text.split(/\s+/).filter((s) => s && !isWebLink(s));
        return invalid.length
            ? [`Not a valid link: ${invalid.join(', ')}.`]
            : [];
    }
    let list: unknown;
    try {
        list = JSON.parse(text);
    } catch {
        return ['Links could not be read.'];
    }
    if (!Array.isArray(list)) return ['Links could not be read.'];
    if (list.length > 8) return ['Add at most 8 links.'];
    const problems: string[] = [];
    list.forEach((item, i) => {
        const n = i + 1;
        const link = item as { type?: unknown; url?: unknown; name?: unknown };
        const info = typeof link?.type === 'string'
            ? LINK_TYPES[link.type]
            : undefined;
        if (!info) {
            problems.push(`Link ${n} has no type.`);
            return;
        }
        if (
            typeof link.url !== 'string' || link.url.length > 200 ||
            !isWebLink(link.url)
        ) {
            problems.push(`Link ${n} isn't a valid link.`);
            return;
        }
        if (info.hosts) {
            const host = new URL(
                /^[a-z][a-z0-9+.-]*:\/\//i.test(link.url)
                    ? link.url
                    : `https://${link.url}`,
            ).hostname.toLowerCase().replace(/^www\./, '');
            if (!info.hosts.some((h) => host === h || host.endsWith(`.${h}`))) {
                problems.push(
                    `Link ${n} isn't ${
                        /^[aeiou]/i.test(info.label) ? 'an' : 'a'
                    } ${info.label} link.`,
                );
            }
        }
        if (link.name !== undefined && typeof link.name !== 'string') {
            problems.push(`Link ${n} has an invalid name.`);
        } else if (typeof link.name === 'string' && link.name.length > 30) {
            problems.push(`Link ${n}'s name must be at most 30 characters.`);
        } else if (link.type === 'other' && !link.name?.trim()) {
            problems.push(`Link ${n} needs a name.`);
        }
    });
    return problems;
};

/* the organization columns a charter edit may change (the organizationedits
   columns); anything else, like state or joinable, is never approved through
   an edit */
export const EDITABLE_CHARTER_FIELDS = [
    'name',
    'url',
    'socials',
    'picture',
    'mission',
    'purpose',
    'appointment_procedures',
    'uniqueness',
    'meeting_schedule',
    'meeting_days',
    'tags',
    'commitment_level',
    'keywords',
    'goals',
    'meeting_description',
    'fair',
    'faculty_email',
];

const countWords = (value: string) =>
    value.trim() ? value.trim().split(/\s+/).length : 0;

export const cleanCharter = <T extends { [field: string]: any }>(
    fields: T,
): T => {
    const cleaned: { [field: string]: any } = { ...fields };

    for (const [field, value] of Object.entries(cleaned)) {
        if (typeof value === 'string') {
            cleaned[field] = stripWhitespace(value);
        } else if (Array.isArray(value)) {
            cleaned[field] = value.map((item) =>
                typeof item === 'string' ? stripWhitespace(item) : item
            );
        }
    }

    if (typeof cleaned.url === 'string') {
        cleaned.url = cleaned.url.toLowerCase().replace(/\s+/g, '-');
    }

    if (typeof cleaned.keywords === 'string') {
        cleaned.keywords = cleaned.keywords
            .split(',')
            .map((keyword: string) => keyword.trim())
            .filter(Boolean)
            .join(',');
    }

    return cleaned as T;
};

export const validateCharter = (
    fields: { [field: string]: any },
    requireAll: boolean,
) => {
    const problems: string[] = [];

    for (const [field, rule] of Object.entries(RULES)) {
        const present = field in fields && fields[field] !== null &&
            fields[field] !== undefined;

        if (!present) {
            if (requireAll && rule.required) {
                problems.push(`${rule.label} is required.`);
            }
            continue;
        }

        const value = fields[field];
        if (typeof value !== 'string') {
            problems.push(`${rule.label} must be text.`);
            continue;
        }

        if (value.length === 0) {
            if (rule.required) problems.push(`${rule.label} is required.`);
            continue;
        }

        if (rule.minChar && value.length < rule.minChar) {
            problems.push(
                `${rule.label} must be at least ${rule.minChar} characters.`,
            );
        }
        if (rule.maxChar && value.length > rule.maxChar) {
            problems.push(
                `${rule.label} must be at most ${rule.maxChar} characters.`,
            );
        }

        const words = countWords(value);
        if (rule.minWords && words < rule.minWords) {
            problems.push(
                `${rule.label} must be at least ${rule.minWords} words (it has ${words}).`,
            );
        }
        if (rule.maxWords && words > rule.maxWords) {
            problems.push(
                `${rule.label} must be at most ${rule.maxWords} words (it has ${words}).`,
            );
        }

        if (rule.pattern && !rule.pattern.test(value)) {
            problems.push(`${rule.label} ${rule.patternMessage}.`);
        }
    }

    if (typeof fields.socials === 'string' && fields.socials) {
        problems.push(...socialsProblems(fields.socials));
    }

    if (
        fields.commitment_level !== undefined &&
        fields.commitment_level !== null &&
        !COMMITMENT_LEVELS.includes(fields.commitment_level)
    ) {
        problems.push('Commitment level is not valid.');
    } else if (requireAll && !fields.commitment_level) {
        problems.push('Commitment level is required.');
    }

    if (fields.tags !== undefined && fields.tags !== null) {
        if (!Array.isArray(fields.tags) || fields.tags.length > MAX_TAGS) {
            problems.push(`Select at most ${MAX_TAGS} tags.`);
        }
    }

    if (typeof fields.keywords === 'string' && fields.keywords) {
        const keywords = fields.keywords.split(',').filter(Boolean);
        if (keywords.length > MAX_KEYWORDS) {
            problems.push(`Use at most ${MAX_KEYWORDS} keywords.`);
        }
    }

    if (fields.meeting_days !== undefined && fields.meeting_days !== null) {
        if (!Array.isArray(fields.meeting_days)) {
            problems.push('Meeting days must be a list.');
        } else if (requireAll && fields.meeting_days.length === 0) {
            problems.push('Select at least one meeting day.');
        }
    } else if (requireAll) {
        problems.push('Select at least one meeting day.');
    }

    return problems;
};

/* the site's own paths, which a club URL would hide or be hidden behind */
export const RESERVED_PATHS = [
    'catalog',
    'create',
    'about',
    'meetings',
    'rules',
    'archive',
    'modules',
    'admin',
    'attendance',
    'opportunities',
    'valentines',
    'today',
    'announcements',
    // the site's own top-level pages, which a club URL would be hidden behind
    'stuyactivities',
    'charter',
    'archives',
    'activities-support',
    'arista-landing',
    'confirm-join',
    'communications',
    'preferences',
    'profile',
    'vote',
];
