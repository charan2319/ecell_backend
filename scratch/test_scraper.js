const cheerio = require('cheerio');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function scrapeProductData(url, maxImages = 4) {
  const images = [];
  let scrapedPrice = 0;
  let scrapedTitle = '';
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-GB;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      timeout: 30000,
    });
    console.log('Status:', response.status);
    const html = await response.text();
    const $ = cheerio.load(html);
    
    // Check for title
    scrapedTitle = $('#productTitle').text().trim() || $('.B_NuCI').text().trim() || $('title').text().trim();
    console.log('Title:', scrapedTitle);
    
    // Check for price
    const flipkartPrice = $('._30jeq3').first().text().trim();
    if (flipkartPrice) scrapedPrice = flipkartPrice;
    console.log('Price:', scrapedPrice);

  } catch (err) {
    console.error('Error:', err.message);
  }
}

const testUrl = 'https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4';
scrapeProductData(testUrl);
