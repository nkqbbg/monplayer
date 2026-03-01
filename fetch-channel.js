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
        // console.log($);
        const btnWatchElements = $('.btn-watch');
        console.log(`✅ Found ${btnWatchElements.length} elements with class "btn-watch":\n`);

        let elementLinks = btnWatchElements.toArray().map(el => $(el).attr('href'));

        // Add the user requested link as a fallback if it's not already there
        const testLink = '/havre-athletic-club-vs-paris-saint-germain-2397996';
        if (!elementLinks.includes(testLink)) {
            elementLinks.unshift(testLink);
        }

        const matches = [];

        const card = $('.card-match').first();   // lấy card đầu tiên
        const style = card.find('.card-bg-blur').attr('style');

        let backgroundUrl = null;

        if (style) {
        const match = style.match(/url\((.*?)\)/);
        if (match && match[1]) {
            backgroundUrl = match[1];

            if (backgroundUrl.startsWith('/')) {
            backgroundUrl = `https://hoadaotv.org${backgroundUrl}`;
            }
        }
        }


        for (const el of $('.cm-wrap').toArray()) {
            const card = $(el);

            const home = card.find('.team-home .name-short').text().trim();
            const away = card.find('.team-away .name-short').text().trim();

            const [time, date] = card.find('.time span')
                .map((i, el) => $(el).text().trim())
                .get();

            const league = card.find('.league').text().trim();
            const status = card.find('.text-timeinplay').text().trim();

            const leagueIcon = card.find('.corner img').attr('src');
            const homeIcon =
            card.find('.team-home .base-icon img').attr('data-src');
            const awayIcon = card.find('.team-away .base-icon img').attr('src');
            const matchPath = card.find('.match-link-overlay').attr('href');
            if (!matchPath) continue;

            const matchLink = matchPath.startsWith('http')
                ? matchPath
                : `https://hoadaotv.org${matchPath}`;

            console.log(`🔗 Scraping stream for: ${home} vs ${away}`);

            // ⭐ STREAM LINK Ở ĐÂY
            const streamLinks = await scrapelink(matchLink);

            matches.push({
                league,
                time,
                date,
                status,
                link: matchLink,
                streams: streamLinks || [],
                backUrl: backgroundUrl,

                teams: {
                    home: {
                        name: home,
                        icon: homeIcon
                    },
                    away: {
                        name: away,
                        icon: awayIcon
                    }
                },

                icons: {
                    league: leagueIcon
                        ? `https://hoadaotv.org${leagueIcon}`
                        : null
                }
            });
        }

        // console.log(matches);

        const hasStream = matches.some(m => m.streams && Object.keys(m.streams).length > 0);

        if (!hasStream) {
        console.log('⚠️ No stream links found.');
        }
        return matches;

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
    // console.log(list);
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
            // console.log({item})
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
                    },
                    {
                        "position": "center",
                        "text": `${item.teams.home.name} - ${item.teams.away.name}`,
                        "color": "#2196F3",
                        "text_color": "#FFFFFF",
                        "font_size": 28,
                        "font_weight": "bold"
                    },
                    {
                        "position": "top-right",
                        "text": `${item.time} | ${item.date}`,
                        "color": "#4CAF50",
                        "text_color": "#FFFFFF"
                    },
                    {
                        "position": "bottom-right",
                        "text": item.league || "",
                        "color": "#FF9800",
                        "text_color": "#FFFFFF"
                    }
                ],
                "description": item.time,
                "image": {
                    "url": item.backUrl,
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
                                                "url": item.streams.hd || item.streams.fullhd || item.streams.sd,
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

