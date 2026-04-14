const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const db = require('../models/db');
const { verifyToken, isAdmin } = require('../middleware/auth');
require('dotenv').config();

const router = express.Router();

// Multer: store Excel file in memory
const excelUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (['xlsx', 'xls', 'csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only .xlsx, .xls, or .csv files are allowed'), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// S3 client
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'ap-south-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// ─── Helper: Upload image buffer to S3 ───
async function uploadBufferToS3(buffer, contentType, filename) {
  const key = `founders_mart/images/${filename}`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType
  }));
  return `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// ─── Helper: Scrape Product Data (Images + Price) from Any Site ───
async function scrapeProductData(url, maxImages = 4) {
  const images = [];
  let scrapedPrice = 0;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9,hi;q=0.8',
        'Accept-Encoding': 'identity',
      }
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    // ━━━━━━━ PRICE SCRAPING ━━━━━━━

    // 1. JSON-LD Schema price (most reliable — works on Amazon, Flipkart, Myntra, etc.)
    $('script[type="application/ld+json"]').each((i, el) => {
      if (scrapedPrice > 0) return;
      try {
        const data = JSON.parse($(el).html());
        const extractPrice = (item) => {
          if (!item) return 0;
          // Direct offers.price
          if (item.offers) {
            const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
            for (const offer of offers) {
              const p = parseFloat(offer.price || offer.lowPrice || 0);
              if (p > 0) return Math.round(p);
            }
          }
          return 0;
        };
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item['@type'] === 'Product') { scrapedPrice = extractPrice(item); break; }
          }
        } else if (data['@type'] === 'Product') {
          scrapedPrice = extractPrice(data);
        } else if (data['@graph']) {
          for (const item of data['@graph']) {
            if (item['@type'] === 'Product') { scrapedPrice = extractPrice(item); break; }
          }
        }
      } catch (e) { }
    });

    // 2. Amazon-specific price selectors
    if (scrapedPrice === 0) {
      const amazonPriceSelectors = [
        '.a-price .a-offscreen',
        '#priceblock_dealprice',
        '#priceblock_ourprice',
        '#priceblock_saleprice',
        '.a-price-whole',
        '#corePrice_feature_div .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-offscreen',
        '.priceToPay .a-offscreen',
      ];
      for (const selector of amazonPriceSelectors) {
        const text = $(selector).first().text().trim();
        if (text) {
          const match = text.replace(/[₹,\s]/g, '').match(/[\d.]+/);
          if (match) {
            const p = parseFloat(match[0]);
            if (p > 0) { scrapedPrice = Math.round(p); break; }
          }
        }
      }
    }

    // 3. Flipkart-specific price selectors
    if (scrapedPrice === 0) {
      const flipkartSelectors = [
        '._30jeq3', // Flipkart main price
        '._16Jk6d', // Flipkart deal price
        '.CEmiEU div._30jeq3',
      ];
      for (const selector of flipkartSelectors) {
        const text = $(selector).first().text().trim();
        if (text) {
          const match = text.replace(/[₹,\s]/g, '').match(/[\d.]+/);
          if (match) {
            const p = parseFloat(match[0]);
            if (p > 0) { scrapedPrice = Math.round(p); break; }
          }
        }
      }
    }

    // 4. og:price / product:price meta tags
    if (scrapedPrice === 0) {
      const metaPrice = $('meta[property="og:price:amount"]').attr('content') ||
                         $('meta[property="product:price:amount"]').attr('content') ||
                         $('meta[name="twitter:data1"]').attr('content') || '';
      const match = metaPrice.replace(/[₹,\s]/g, '').match(/[\d.]+/);
      if (match) {
        const p = parseFloat(match[0]);
        if (p > 0) scrapedPrice = Math.round(p);
      }
    }

    // 5. Generic fallback: look for ₹ or Rs. followed by a number anywhere in common price containers
    if (scrapedPrice === 0) {
      const priceContainers = [
        '[class*="price"]', '[class*="Price"]',
        '[id*="price"]', '[id*="Price"]',
        '[class*="cost"]', '[class*="amount"]',
      ];
      for (const selector of priceContainers) {
        $(selector).each((i, el) => {
          if (scrapedPrice > 0) return;
          const text = $(el).text();
          // Match ₹1,234 or Rs. 1234 or INR 1234 patterns
          const match = text.match(/(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.\d{1,2})?)/);
          if (match) {
            const p = parseFloat(match[1].replace(/,/g, ''));
            if (p > 0 && p < 1000000) scrapedPrice = Math.round(p);
          }
        });
        if (scrapedPrice > 0) break;
      }
    }

    console.log(`[Scraper] Price found: ₹${scrapedPrice} from ${url}`);

    // ━━━━━━━ IMAGE SCRAPING ━━━━━━━

    // 1. JSON-LD Schema images
    let schemaImages = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        const extractImages = (item) => {
          if (item && item['@type'] === 'Product' && item.image) {
            if (Array.isArray(item.image)) schemaImages.push(...item.image);
            else if (typeof item.image === 'string') schemaImages.push(item.image);
          }
        };
        if (Array.isArray(data)) data.forEach(extractImages);
        else extractImages(data);
        if (data && data['@graph']) data['@graph'].forEach(extractImages);
      } catch (e) { }
    });
    
    schemaImages.forEach(img => {
      if (img && !images.includes(img) && images.length < maxImages) images.push(img);
    });

    // 2. Amazon Specific (data-a-dynamic-image)
    if (images.length < maxImages) {
      const dynamicImageEl = $('[data-a-dynamic-image]').first();
      if (dynamicImageEl.length) {
        try {
          const imgData = JSON.parse(dynamicImageEl.attr('data-a-dynamic-image'));
          const urls = Object.keys(imgData);
          for (const u of urls) {
            if (!images.includes(u) && images.length < maxImages) images.push(u);
          }
        } catch (e) { }
      }
    }

    // 3. Open Graph image
    if (images.length < maxImages) {
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage && !images.includes(ogImage)) images.push(ogImage);
    }

    // 4. Generic product image selectors
    if (images.length < maxImages) {
      $('img').each((i, el) => {
        if (images.length >= maxImages) return;
        let src = $(el).attr('src') || $(el).attr('data-src') || '';
        src = src.replace(/\._[^.]*_\./, '.'); // Amazon hi-res fix
        const classNames = ($(el).attr('class') || '').toLowerCase();
        if (src && src.startsWith('http') && 
            !src.includes('logo') && !src.includes('icon') && !src.includes('sprite') &&
            !images.includes(src)) {
            if (classNames.includes('product') || classNames.includes('image') || src.includes('imageright') || src.includes('image1')) {
                images.push(src);
            }
        }
      });
    }

    // 5. Fallback
    if (images.length === 0) {
      const mainImg = $('#landingImage').attr('src') || $('#imgBlkFront').attr('src') || $('.product-image img').attr('src');
      if (mainImg) images.push(mainImg);
    }

  } catch (err) {
    console.error(`Error scraping URL ${url}:`, err.message);
  }
  return { images: images.slice(0, maxImages), price: scrapedPrice };
}

// ─── Helper: Download image from URL and return buffer ───
async function downloadImage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error(`Failed to download image: ${url}`, err.message);
    return null;
  }
}

// ─── Helper: Auto-categorize product name ───
function autoCategorizeName(productName, existingCategories) {
  const nameLower = productName.toLowerCase();

  // Keywords mapped to common e-commerce categories
  const categoryKeywords = {
    'Electronics': ['headphone', 'earphone', 'earbuds', 'speaker', 'bluetooth', 'wireless', 'charger', 'adapter', 'cable', 'usb', 'power bank', 'battery', 'led', 'light', 'lamp', 'fan', 'electronic', 'gadget', 'smartwatch', 'watch', 'clock', 'timer', 'sensor', 'remote'],
    'Laptops': ['laptop', 'notebook', 'macbook', 'chromebook'],
    'Phones': ['phone', 'mobile', 'smartphone', 'iphone', 'samsung galaxy', 'oneplus', 'pixel'],
    'Stationery': ['pen', 'pencil', 'notebook', 'diary', 'planner', 'marker', 'highlighter', 'eraser', 'sharpener', 'stapler', 'tape', 'glue', 'scissors', 'ruler', 'compass', 'stationery', 'sticky notes', 'paper'],
    'Books': ['book', 'novel', 'textbook', 'guide', 'manual', 'edition', 'paperback', 'hardcover'],
    'Clothing': ['shirt', 'tshirt', 't-shirt', 'hoodie', 'jacket', 'sweater', 'jeans', 'pants', 'trouser', 'shorts', 'dress', 'skirt', 'clothing', 'apparel', 'wear', 'cap', 'hat', 'socks'],
    'Footwear': ['shoe', 'sneaker', 'sandal', 'slipper', 'boot', 'footwear', 'flip flop', 'crocs'],
    'Bags': ['bag', 'backpack', 'handbag', 'luggage', 'suitcase', 'pouch', 'wallet', 'purse', 'tote'],
    'Accessories': ['keychain', 'ring', 'bracelet', 'necklace', 'chain', 'sunglasses', 'glasses', 'belt', 'accessory', 'accessories', 'ornament'],
    'Food & Beverages': ['chocolate', 'snack', 'chips', 'biscuit', 'cookie', 'candy', 'drink', 'bottle', 'mug', 'cup', 'flask', 'coffee', 'tea', 'food'],
    'Home & Living': ['pillow', 'cushion', 'blanket', 'bedsheet', 'towel', 'mat', 'rug', 'candle', 'frame', 'photo', 'vase', 'decor', 'decoration', 'home', 'living', 'curtain', 'mirror'],
    'Sports': ['ball', 'bat', 'racket', 'gym', 'fitness', 'yoga', 'sport', 'exercise', 'dumbbell', 'skipping', 'cycling'],
    'Gaming': ['game', 'gaming', 'controller', 'console', 'playstation', 'xbox', 'nintendo', 'joystick', 'mouse pad', 'mousepad'],
    'Beauty & Personal Care': ['perfume', 'deodorant', 'cream', 'lotion', 'shampoo', 'soap', 'face wash', 'moisturizer', 'sunscreen', 'grooming', 'trimmer', 'razor', 'beauty', 'skincare', 'makeup'],
    'Toys & Games': ['toy', 'puzzle', 'board game', 'rubik', 'fidget', 'spinner', 'lego', 'doll', 'action figure']
  };

  // First, try to match against existing categories (case-insensitive)
  for (const cat of existingCategories) {
    const catLower = cat.toLowerCase();
    // Check if the category name appears in the product name or vice versa
    if (nameLower.includes(catLower) || catLower.split(' ').some(word => word.length > 3 && nameLower.includes(word))) {
      return cat;
    }
  }

  // Then try keyword matching
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (nameLower.includes(keyword)) {
        // Check if this category already exists (case-insensitive)
        const existingMatch = existingCategories.find(c => c.toLowerCase() === category.toLowerCase());
        return existingMatch || category;
      }
    }
  }

  // Fallback: Use the first significant word as a new category
  const words = productName.split(/\s+/).filter(w => w.length > 3);
  if (words.length > 0) {
    const newCat = words[0].charAt(0).toUpperCase() + words[0].slice(1).toLowerCase();
    // Check if it matches any existing
    const existingMatch = existingCategories.find(c => c.toLowerCase() === newCat.toLowerCase());
    return existingMatch || newCat;
  }

  return 'Uncategorized';
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/products/bulk-upload
// Excel columns: ProductName | Price | Link
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/bulk-upload', verifyToken, isAdmin, excelUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Parse Excel
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rows.length === 0) {
      return res.status(400).json({ message: 'Excel file is empty' });
    }

    // Fetch existing categories
    const catResult = await db.query('SELECT name FROM categories ORDER BY name ASC');
    let existingCategories = catResult.rows.map(r => r.name);

    // Ensure product_images table exists
    await db.query(`
      CREATE TABLE IF NOT EXISTS product_images (
        id SERIAL PRIMARY KEY,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        image_url TEXT NOT NULL
      )
    `);

    const results = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      // Support multiple possible column header names
      const productName = row['ProductName'] || row['Product Name'] || row['product_name'] || row['Name'] || row['name'] || '';
      const priceRaw = row['Price'] || row['price'] || row['price_vc'] || row['Cost'] || 0;
      const link = row['Link'] || row['link'] || row['URL'] || row['url'] || row['Amazon Link'] || '';

      if (!productName) {
        errors.push({ row: i + 2, error: 'Missing product name' });
        continue;
      }

      const excelPrice = parseInt(priceRaw) || 0;

      try {
        // Auto-categorize
        const category = autoCategorizeName(productName, existingCategories);

        // Create category if it doesn't exist
        if (!existingCategories.includes(category)) {
          await db.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [category]);
          existingCategories.push(category);
        }

        // Scrape images AND price from the product link
        let imageUrls = [];
        let scrapedPriceFromLink = 0;
        if (link && link.trim()) {
          console.log(`[Bulk Upload] Scraping data for: ${productName} from ${link}`);
          const scraped = await scrapeProductData(link.trim());
          scrapedPriceFromLink = scraped.price || 0;

          // Download and upload each image to S3
          for (let j = 0; j < scraped.images.length; j++) {
            const imgBuffer = await downloadImage(scraped.images[j]);
            if (imgBuffer && imgBuffer.length > 1000) { // Skip tiny/broken images
              const ext = scraped.images[j].match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] || 'jpg';
              const filename = `${uuidv4()}.${ext}`;
              const s3Url = await uploadBufferToS3(imgBuffer, `image/${ext}`, filename);
              imageUrls.push(s3Url);
            }
          }
        }

        // Use Excel price if provided, otherwise use scraped price
        const finalPrice = excelPrice > 0 ? excelPrice : scrapedPriceFromLink;
        const priceSource = excelPrice > 0 ? 'excel' : (scrapedPriceFromLink > 0 ? 'scraped' : 'none');

        const mainImage = imageUrls.length > 0 ? imageUrls[0] : '';

        // Insert product
        const insertResult = await db.query(
          'INSERT INTO products (name, description, price_vc, original_price, delivery_location, delivery_time, image_url, category, brand, stock, is_new_arrival) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
          [productName, '', finalPrice, scrapedPriceFromLink > 0 ? scrapedPriceFromLink : null, 'Alliance University', '7 Days', mainImage, category, '', 100, false]
        );
        const productId = insertResult.rows[0].id;

        // Insert extra images
        for (let k = 1; k < imageUrls.length; k++) {
          await db.query(
            'INSERT INTO product_images (product_id, image_url) VALUES ($1, $2)',
            [productId, imageUrls[k]]
          );
        }

        results.push({
          row: i + 2,
          name: productName,
          price: finalPrice,
          priceSource,
          category,
          images: imageUrls.length,
          status: 'success'
        });

        console.log(`[Bulk Upload] ✅ Added: ${productName} | ${finalPrice} VC (${priceSource}) | ${category} | ${imageUrls.length} images`);

      } catch (productErr) {
        console.error(`[Bulk Upload] ❌ Row ${i + 2} error:`, productErr.message);
        errors.push({ row: i + 2, name: productName, error: productErr.message });
      }
    }

    res.json({
      message: `Bulk upload complete. ${results.length} products added, ${errors.length} errors.`,
      total: rows.length,
      success: results.length,
      failed: errors.length,
      results,
      errors
    });

  } catch (err) {
    console.error('[Bulk Upload] Fatal error:', err);
    res.status(500).json({ message: 'Bulk upload failed: ' + err.message });
  }
});

// ─── GET template info ───
router.get('/bulk-upload/template', (req, res) => {
  res.json({
    columns: ['ProductName', 'Price (Optional)', 'Link'],
    example: [
      { ProductName: 'boAt Rockerz 450 Bluetooth Headphone', Price: '', Link: 'https://www.amazon.in/dp/B07SZG2FHN' },
      { ProductName: 'Cello Butterflow Ball Pen Pack', Price: 200, Link: 'https://www.amazon.in/dp/B08YKDLKFK' }
    ],
    instructions: 'Create an Excel file (.xlsx) with columns: ProductName, Price, Link. Price is optional — if left empty, the price will be automatically fetched from the product link. Link should be the full e-commerce product URL (Amazon, Flipkart, Meesho, Myntra, etc).'
  });
});

module.exports = router;
