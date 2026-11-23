export const footer = `

Best,
The Epsilon Team

If you have general questions about Clubs & Pubs, reach out to us at clubpub@stuysu.org. If you need any technical assistance, email us at it@stuysu.org.`;

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

export const escapeHtml = (text: string) =>
    text.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
