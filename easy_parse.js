const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./models/db'); // Uses your existing DB connection

/**
 * Easy Parse - Amazon Link Parser
 * 
 * Usage: node easy_parse.js <https://amazon.in/link> <PRODUCT_ID>
 * 
 * This script visits the Amazon link, extracts the Technical Details / Specifications,
 * and automatically updates the specified product in your backend database.
 */

async function easyParse(url, productId) {
    if (!url || !productId) {
        console.error("❌ Please provide both a URL and a Product ID.");
        console.log("Usage: node easy_parse.js <AMAZON_LINK> <PRODUCT_ID>");
        return;
    }

    try {
        console.log(`\n🔍 Fetching product details from: ${url}...`);
        
        // Use browser-like headers to bypass simple blocks
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        });

        const $ = cheerio.load(response.data);
        const specifications = [];

        console.log(`⚡ Parsing the Technical Details table...`);

        // Amazon usually stores technical details in a table with id 'productDetails_techSpec_section_1'
        // Let's grab all rows from that table.
        $('#productDetails_techSpec_section_1 tbody tr').each((i, row) => {
            let label = $(row).find('th').text().trim();
            // remove non-breaking spaces and zero-width spaces
            label = label.replace(/[\u200B-\u200D\uFEFF]/g, '');
            
            let value = $(row).find('td').text().trim();
            value = value.replace(/[\u200B-\u200D\uFEFF]/g, '');

            if (label && value) {
                specifications.push({ label, value });
            }
        });

        if (specifications.length === 0) {
            console.log("⚠️ No Technical Details found via simple parsing. (Amazon may have changed its layout or blocked the request).");
            console.log("Here's a sample payload you can manually pass to your PUT API instead:");
            console.log(JSON.stringify({ specifications: [{ label: "Example", value: "Value" }] }, null, 2));
            process.exit(1);
            return;
        }

        console.log(`✅ Successfully extracted ${specifications.length} specifications!`);
        console.table(specifications);

        console.log(`\n💾 Saving to database for Product ID [${productId}]...`);
        // We added specifications column to products table, now we update it
        await db.query(
            'UPDATE products SET specifications = $1 WHERE id = $2',
            [JSON.stringify(specifications), productId]
        );

        console.log('🎉 Done! Product updated successfully in ecell_backend.');

    } catch (error) {
        console.error("❌ Error parsing the link:");
        if (error.response && error.response.status === 503) {
            console.error("Amazon blocked the request (HTTP 503). For heavy Amazon scraping, you will need Puppeteer or a Scraper API.");
        } else {
            console.error(error.message);
        }
    } finally {
        // Close DB pool connection nicely
        process.exit(0);
    }
}

// Get arguments from command line
const link = process.argv[2];
const prodId = process.argv[3];
easyParse(link, prodId);
