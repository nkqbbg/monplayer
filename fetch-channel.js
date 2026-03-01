const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Helper to generate a random ID
 */
function generateId(prefix = 'id') {
    return `${prefix}-${crypto.randomBytes(6).toString('hex')}`;
}

/**
 * Scrapes hoadaotv.org/soccer and returns a list of stream data
 */
async function scrapeSoccer() {
    const url = 'https://hoadaotv.org/soccer';
    console.log(`🚀 Fetching data from ${url}...`);

    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const $ = cheerio.load(html);
        const btnWatchElements = $('.btn-watch');
        console.log(`✅ Found ${btnWatchElements.length} elements with class "btn-watch":\n`);

        let elementLinks = btnWatchElements.toArray().map(el => $(el).attr('href'));

        // Add the user requested link as a fallback if it's not already there
        const testLink = '/havre-athletic-club-vs-paris-saint-germain-2397996';
        if (!elementLinks.includes(testLink)) {
            elementLinks.unshift(testLink);
        }

        const list = [];
        // Use for...of to correctly await async calls
        for (const link of elementLinks) {
            if (!link || link.includes("www")) continue;

            const fullLink = link.startsWith('http') ? link : `https://hoadaotv.org${link}`;
            const label = link.replace("/", "");

            console.log('🔗 Processing Label: ', label);
            const streamLinks = await scrapelink(fullLink);

            if (streamLinks) {
                console.log(`✅ Found stream links for: ${label}`);
                list.push({
                    label: label,
                    link: fullLink,
                    streamLinks: streamLinks
                });
            }
        }

        if (list.length === 0) {
            console.log('⚠️ No channels with stream links found.');
        }
        return list;

    } catch (error) {
        console.error('❌ Error during scraping:', error.message);
        return [];
    }
}

async function scrapelink(link) {
    try {
        const response = await axios.get(link, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        // Search for the line with const serverStreamLinks
        const match = html.match(/const\s+serverStreamLinks\s*=\s*({.*?});/s);

        if (match && match[1]) {
            try {
                return JSON.parse(match[1]);
            } catch (e) {
                console.error(`❌ JSON Parse Error for ${link}`);
                return null;
            }
        }
        return null;
    } catch (error) {
        console.error(`❌ Error scraping ${link}:`, error.message);
        return null;
    }
}

async function main() {
    console.log('🏁 Starting Scraper...');
    const list = await scrapeSoccer();

    console.log(`\n📊 Scraping finished. Total channels with streams: ${list.length}`);

    if (list.length === 0) {
        console.log('⚠️ No data to save. (Matches might not have started yet)');
        return;
    }

    try {
        const templatePath = path.join(__dirname, 'template.json');
        if (!fs.existsSync(templatePath)) {
            throw new Error(`Template not found at ${templatePath}`);
        }

        const templateData = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

        const channels = list.map(item => {
            const channelId = generateId('ch');
            return {
                "id": channelId,
                "name": item.label,
                "labels": [
                    {
                        "position": "top-left",
                        "text": "● Live",
                        "color": "#FF0000",
                        "text_color": "#FFFFFF"
                    }
                ],
                "description": "Live Stream",
                "image": templateData.groups[0]?.channels[0]?.image || {
                    "url": "https://kaytee1012.github.io/buncha_logo.png",
                    "height": 480,
                    "width": 640,
                    "display": "cover",
                    "shape": "square"
                },
                "type": "single",
                "display": "text-below",
                "sources": [
                    {
                        "id": generateId('src'),
                        "name": "Server 1",
                        "contents": [
                            {
                                "id": generateId('ct'),
                                "name": item.label,
                                "streams": [
                                    {
                                        "id": generateId('st'),
                                        "name": "Server 1",
                                        "stream_links": [
                                            {
                                                "id": generateId('lnk'),
                                                "name": "HD",
                                                "type": "hls",
                                                "default": true,
                                                "url": item.streamLinks.hd || item.streamLinks.fullhd || item.streamLinks.sd,
                                                "request_headers": [
                                                    { "key": "Referer", "value": item.link },
                                                    { "key": "User-Agent", "value": "Mozilla/5.0" }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };
        });

        // Update template
        if (!templateData.groups) templateData.groups = [{}];
        templateData.groups[0].channels = channels;

        const outputPath = path.join(__dirname, 'channels.json');
        fs.writeFileSync(outputPath, JSON.stringify(templateData, null, 4));

        console.log(`\n🎉 Success! File generated: ${outputPath}`);
        console.log(`📁 Captured ${channels.length} live channels.`);

    } catch (error) {
        console.error('❌ Error generating JSON:', error.message);
    }
}

main();

