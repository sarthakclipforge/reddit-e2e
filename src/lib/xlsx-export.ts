/**
 * Client-side XLSX export using ExcelJS.
 * Generates and downloads an Excel file with Reddit post data.
 */

import ExcelJS from 'exceljs';
import { RedditPost } from '@/types';

/**
 * Export Reddit posts to an XLSX file and trigger browser download.
 */
export async function exportToXLSX(posts: RedditPost[], keywords: string): Promise<void> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Reddit Posts');

    worksheet.columns = [
        { header: 'Title', key: 'title', width: 60 },
        { header: 'Subreddit', key: 'subreddit', width: 20 },
        { header: 'Upvotes', key: 'upvotes', width: 10 },
        { header: 'Comments', key: 'comments', width: 10 },
        { header: 'Author', key: 'author', width: 18 },
        { header: 'Posted Date', key: 'created', width: 15 },
        { header: 'URL', key: 'link', width: 50 },
    ];

    worksheet.getRow(1).font = { bold: true };

    for (const post of posts) {
        worksheet.addRow({
            title: post.title,
            subreddit: post.subreddit,
            upvotes: post.upvotes,
            comments: post.comments,
            author: post.author,
            created: new Date(post.created).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            }),
            link: post.link,
        });
    }

    // Generate filename with sanitized keywords
    const sanitizedKeywords = keywords
        .replace(/[^a-zA-Z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 30);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `reddit-search-${sanitizedKeywords}-${timestamp}.xlsx`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob(
        [buffer],
        {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
