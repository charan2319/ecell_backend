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

// Ensure categories table exists and is populated from products
const ensureCategoriesTable = async () => {
    await db.query(`
        CREATE TABLE IF NOT EXISTS categories (
            name TEXT PRIMARY KEY
        )
    `);
    // Sync existing categories from products table
    await db.query(`
        INSERT INTO categories (name)
        SELECT DISTINCT category FROM products
        WHERE category IS NOT NULL AND category != ''
        ON CONFLICT (name) DO NOTHING
    `);
};

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

// ─── Helper: Scrape Product Data (Title + Images + Price) from Any Site ───
async function scrapeProductData(url, maxImages = 4) {
  const images = [];
  let scrapedPrice = 0;
  let scrapedTitle = '';
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://www.google.com/',
      },
      timeout: 15000,
      signal: controller.signal,
      validateStatus: () => true, // Handle 404/403 gracefully
    });

    clearTimeout(timeout);

    if (response.status !== 200) {
      console.warn(`[Scraper] Failed to fetch ${url}. Status: ${response.status}`);
      if (response.status === 403 || response.status === 503) {
        throw new Error(`Access denied by ${new URL(url).hostname}. The site is blocking automated requests.`);
      }
      throw new Error(`Server returned status ${response.status}`);
    }

    const html = response.data;
    const $ = cheerio.load(html);

    // Helper to find data in JSON-LD
    const findInJsonLd = (targetType, callback) => {
      $('script[type="application/ld+json"]').each((i, el) => {
        try {
          const data = JSON.parse($(el).html());
          const search = (item) => {
            if (!item) return;
            if (Array.isArray(item)) { item.forEach(search); return; }
            if (item['@type'] === targetType || (Array.isArray(item['@type']) && item['@type'].includes(targetType))) {
              callback(item);
            }
            if (item['@graph']) search(item['@graph']);
            if (item.mainEntity) search(item.mainEntity);
          };
          search(data);
        } catch (e) {}
      });
    };

    // ━━━━━━━ TITLE SCRAPING ━━━━━━━
    // 1. Metadata (Standard across sites)
    scrapedTitle = $('meta[property="og:title"]').attr('content') || 
                   $('meta[name="twitter:title"]').attr('content') || 
                   $('meta[name="title"]').attr('content') || '';

    // 2. JSON-LD
    if (!scrapedTitle) {
      findInJsonLd('Product', (p) => { if (!scrapedTitle && p.name) scrapedTitle = p.name; });
    }

    // 3. Site-Specific Selectors
    if (!scrapedTitle) {
      scrapedTitle = $('#productTitle').text().trim() || // Amazon
                     $('.B_NuCI').text().trim() ||      // Flipkart
                     $('span.VU-ZEz').text().trim() || // Flipkart New
                     $('.pdp-name').text().trim() ||    // Myntra
                     $('h1').first().text().trim() ||   // Generic
                     $('title').text().trim();
    }

    // Clean up title
    scrapedTitle = scrapedTitle
      .replace(/^(Amazon\.in|Amazon|Flipkart|Myntra|Meesho|Buy Online)\s*[:|-]\s*/i, '')
      .replace(/\s*[-|:]\s*(Amazon\.in|Amazon|Flipkart|Myntra|Meesho|Buy Online).*$/i, '')
      .trim();

    console.log(`[Scraper] Title found: "${scrapedTitle}"`);

    // ━━━━━━━ CATEGORY SCRAPING ━━━━━━━
    let scrapedCategory = '';
    // 1. Breadcrumbs
    const breadcrumbSelectors = ['.breadcrumb', '.breadcrumbs', '._1MROuz', '.pdp-breadcrumb', '.a-breadcrumb'];
    for (const sel of breadcrumbSelectors) {
       const text = $(sel).text().trim();
       if (text) {
         const parts = text.split(/›|>|»|\//).map(s => s.trim()).filter(Boolean);
         if (parts.length > 1) {
           scrapedCategory = parts[parts.length - 1]; // Take the last specific category
           if (scrapedCategory.toLowerCase() === scrapedTitle.toLowerCase().substring(0, scrapedCategory.length)) {
             scrapedCategory = parts[parts.length - 2] || scrapedCategory;
           }
           break;
         }
       }
    }
    // 2. Meta tags
    if (!scrapedCategory) {
      scrapedCategory = $('meta[property="og:category"]').attr('content') || 
                        $('meta[name="category"]').attr('content') || '';
    }
    scrapedCategory = scrapedCategory.split(/[|:-]/)[0].trim();

    // ━━━━━━━ PRICE SCRAPING ━━━━━━━
    // 1. JSON-LD Offers (Most reliable)
    findInJsonLd('Product', (p) => {
      if (scrapedPrice > 0) return;
      const offers = Array.isArray(p.offers) ? p.offers : [p.offers].filter(Boolean);
      for (const off of offers) {
        const pr = parseFloat(off.price || off.lowPrice || off.highPrice || 0);
        if (pr > 0) { scrapedPrice = Math.round(pr); break; }
      }
    });

    // 2. Meta Price
    if (scrapedPrice === 0) {
      const priceMetas = [
        'meta[property="og:price:amount"]', 'meta[property="product:price:amount"]',
        'meta[name="twitter:data1"]', 'meta[itemprop="price"]', '[itemprop="price"]'
      ];
      for (const sel of priceMetas) {
        const val = $(sel).attr('content') || $(sel).text().trim();
        if (val) {
          const match = val.replace(/[₹,\s]/g, '').match(/[\d.]+/);
          if (match) {
            const p = parseFloat(match[0]);
            if (p > 0) { scrapedPrice = Math.round(p); break; }
          }
        }
      }
    }

    // 3. Site Specific Selectors
    if (scrapedPrice === 0) {
      const selectors = [
        '.priceToPay .a-offscreen', '.a-price-whole', // Amazon
        '._30jeq3', '.Nx9bqj', '._16Jk6d',           // Flipkart
        '.pdp-price strong', '[class*="ProductPrice"]', // Generic/Meesho
      ];
      for (const sel of selectors) {
        const text = $(sel).first().text().trim();
        const match = text.replace(/[₹,\s]/g, '').match(/[\d.]+/);
        if (match) {
          const p = parseFloat(match[0]);
          if (p > 10) { scrapedPrice = Math.round(p); break; }
        }
      }
    }

    // 4. Fallback search for currency symbols
    if (scrapedPrice === 0) {
      const bodyText = $('body').text();
      const match = bodyText.match(/(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.\d{1,2})?)/);
      if (match) {
        const p = parseFloat(match[1].replace(/,/g, ''));
        if (p > 10 && p < 1000000) scrapedPrice = Math.round(p);
      }
    }

    console.log(`[Scraper] Price found: ₹${scrapedPrice}`);

    // ━━━━━━━ IMAGE SCRAPING ━━━━━━━

    const isLikelyBrandImage = (imgUrl) => {
      const urlLower = imgUrl.toLowerCase();
      const brandFilters = [
        'logo', 'badge', 'banner', 'sprite', 'icon', 'favicon',
        'seller', 'shop-logo', 'merchant', 'trust-badge', 'payment',
        'guarantee', 'warranty', 'rating', 'star-', 'review',
        'advertisement', 'promo', 'coupon', 'offer-badge',
        'placeholder', 'loading', 'lazy-load', 'pixel', 'spacer',
        'arrow', 'checkbox', 'radio', 'button', 'close', 'search',
        'cart', 'wishlist', 'share', 'compare',
      ];
      if (brandFilters.some(f => urlLower.includes(f))) return true;
      if (/\/brand[s]?\//i.test(imgUrl)) return true;
      if (/\/logo[s]?\//i.test(imgUrl)) return true;
      // Small dimension images in URL
      if (/\b\d{1,2}x\d{1,2}\b/.test(imgUrl)) return true;
      // Base64 data URIs or SVGs
      if (imgUrl.startsWith('data:')) return true;
      // Very short URLs are usually icons
      if (imgUrl.length < 30) return true;
      return false;
    };

    const addImage = (src) => {
      if (!src || images.length >= maxImages) return false;
      if (!src.startsWith('http')) return false;
      if (isLikelyBrandImage(src)) return false;
      if (images.includes(src)) return false;
      // Deduplicate by stripping query parameters and removing Amazon size suffixes
      const getBaseNormalized = (url) => {
         try {
           return url.split('?')[0].replace(/\._[A-Z]{2}\d+_\./, '.');
         } catch(err) { return url; }
      }
      const normalizedSrc = getBaseNormalized(src);
      if (images.some(existing => getBaseNormalized(existing) === normalizedSrc)) return false;
      images.push(src);
      return true;
    };

    // 1. JSON-LD Schema images (most reliable)
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        const extractImages = (item) => {
          if (item && item['@type'] === 'Product' && item.image) {
            const imgs = Array.isArray(item.image) ? item.image : [item.image];
            imgs.forEach(img => {
              if (typeof img === 'string') addImage(img);
              else if (img && img.url) addImage(img.url);
            });
          }
        };
        if (Array.isArray(data)) data.forEach(extractImages);
        else { extractImages(data); if (data && data['@graph']) data['@graph'].forEach(extractImages); }
      } catch (e) { }
    });

    // ━━━━━━━ IMAGE SCRAPING ━━━━━━━
    // 1. JSON-LD Images (Highest quality)
    findInJsonLd('Product', (p) => {
      const imgs = Array.isArray(p.image) ? p.image : [p.image].filter(Boolean);
      imgs.forEach(img => {
        const src = typeof img === 'string' ? img : img.url;
        if (src) addImage(src);
      });
    });

    // 2. Amazon: data-a-dynamic-image & high-res upgrade
    const dynamicImageEl = $('[data-a-dynamic-image]').first();
    if (dynamicImageEl.length) {
      try {
        const imgData = JSON.parse(dynamicImageEl.attr('data-a-dynamic-image'));
        Object.keys(imgData).forEach(addImage);
      } catch (e) {}
    }

    // 3. Pinterest/Social Share images (usually good quality)
    const socialImage = $('meta[property="og:image"]').attr('content') || 
                        $('meta[name="twitter:image"]').attr('content') || 
                        $('link[rel="image_src"]').attr('href');
    if (socialImage) addImage(socialImage);

    // 4. Primary Image/Gallery Selectors
    const gallerySelectors = [
      '#altImages img', '#imageBlock img', '.imageThumbnail img', // Amazon
      '._2E1FGS img', '._3kidJX img', '.CXW8mj img', '._2r_T1I img', // Flipkart
      '.pdp-image img', '.pdp-gallery-container img',            // Myntra
      '[class*="ProductImage"]', '[class*="GalleryImage"]',       // Generic/Meesho
      '.slick-slide img', '.swiper-slide img', '.owl-item img'    // Carousels
    ];
    
    gallerySelectors.forEach(sel => {
      $(sel).each((i, el) => {
        if (images.length >= maxImages) return;
        let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-old-hires') || '';
        if (!src || src.startsWith('data:')) return;
        
        // Upgrade thumbnails to High-Res where possible
        // Amazon: 
        src = src.replace(/\._[A-Z]{2}\d+_\./, '.');
        src = src.replace(/\._AC_[A-Z]{2}\d+_\./, '.');
        // Flipkart: 
        src = src.replace(/\/128\/128\//g, '/832/832/');
        src = src.replace(/\/image\/\d+\/\d+\//g, '/image/832/832/');
        
        addImage(src);
      });
    });

    // 5. Fallback for Category/Search listings
    if (images.length === 0) {
      $('.s-image, ._1AtVbE img, .product-item img').each((i, el) => {
        if (images.length >= (maxImages > 4 ? 4 : maxImages)) return;
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        if (src) addImage(src);
      });
    }

    // 6. Last Ditch: Absolute first large-ish image
    if (images.length === 0) {
      $('img').each((i, el) => {
        if (images.length >= 1) return;
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        const w = parseInt($(el).attr('width') || '0');
        const h = parseInt($(el).attr('height') || '0');
        if (src && !isLikelyBrandImage(src) && (w > 200 || h > 200 || src.includes('product'))) {
          addImage(src);
        }
      });
    }

    console.log(`[Scraper] Images found: ${images.length}`);

  } catch (err) {
    if (err.name === 'AbortError') {
      console.error(`[Scraper] Timeout scraping ${url}`);
      throw new Error('Request timed out. The site is taking too long to respond.');
    }
    console.error(`[Scraper] Error scraping ${url}:`, err.message);
    throw err;
  }
  
  return { 
    images: images.slice(0, maxImages), 
    price: scrapedPrice, 
    title: scrapedTitle,
    category: scrapedCategory 
  };
}

// ─── Constants: Known Brands for Auto-detection ───
const KNOWN_BRANDS_LIST = [
  'boAt', 'Boult', 'Noise', 'Zebronics', 'JBL', 'Sony', 'Samsung', 'Apple', 'Xiaomi', 'Mi',
  'Realme', 'OnePlus', 'Oppo', 'Vivo', 'Motorola', 'Nokia', 'LG', 'Philips', 'Panasonic',
  'HP', 'Dell', 'Lenovo', 'Asus', 'Acer', 'MSI', 'Logitech', 'Corsair', 'Razer',
  'Marshall', 'Bose', 'Sennheiser', 'Skullcandy', 'pTron', 'Mivi', 'Portronics',
  'Ambrane', 'Syska', 'Havells', 'Bajaj', 'Crompton',
  'Nike', 'Adidas', 'Puma', 'Reebok', 'Fila', 'Skechers', 'Woodland', 'Bata',
  'Fastrack', 'Titan', 'Casio', 'Timex', 'Fossil', 'Fire-Boltt',
  'Cello', 'Classmate', 'Doms', 'Camlin', 'Natraj',
  'Prestige', 'Pigeon', 'Hawkins', 'Butterfly',
  'Wildcraft', 'American Tourister', 'Safari', 'Skybags',
  'HUION', 'Wacom', 'Anker', 'Belkin', 'Ugreen',
  'Redgear', 'Cosmic Byte', 'Ant Esports', 'Wings', 'Hammer', 'CrossBeats',
  'Maono', 'Fifine', 'Kingston', 'SanDisk', 'Seagate', 'WD', 'Toshiba',
  'Canon', 'Nikon', 'GoPro', 'DJI', 'Fujifilm',
];

// ─── Helper: Detect Brand from Product Name ───
function detectBrand(productName) {
  if (!productName) return '';
  const lowerName = productName.toLowerCase();
  return KNOWN_BRANDS_LIST.find(b => lowerName.includes(b.toLowerCase())) || '';
}

// ─── Helper: Auto-categorize product name ───
function autoCategorizeName(productName, existingCategories = []) {
  if (!productName) return 'General';
  const nameLower = productName.toLowerCase();

  // ── Known brand names that should NEVER be used as categories ──
  const knownBrandsSet = new Set(KNOWN_BRANDS_LIST.map(b => b.toLowerCase()));

  // Check if a word/phrase is a known brand
  const isBrand = (text) => knownBrandsSet.has(text.toLowerCase().trim());

  // Keywords mapped to common e-commerce categories
  const categoryKeywords = {
    'Electronics': ['headphone', 'earphone', 'earbuds', 'speaker', 'bluetooth', 'wireless', 'charger', 'adapter', 'cable', 'usb', 'power bank', 'battery', 'led', 'light', 'lamp', 'fan', 'electronic', 'gadget', 'smartwatch', 'smart watch', 'watch', 'clock', 'timer', 'sensor', 'remote', 'neckband', 'tws', 'soundbar', 'microphone', 'webcam', 'mouse', 'keyboard'],
    'Laptops': ['laptop', 'notebook', 'macbook', 'chromebook', 'victus', 'loq', 'tuf', 'rog', 'predator', 'inspiron', 'vostro', 'thinkpad', 'ideapad'],
    'Tablets': ['tablet', 'ipad', 'tab'],
    'Phones': ['phone', 'mobile', 'smartphone', 'iphone', 'pixel', 'galaxy', 'redmi', 'poco', 'nord'],
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
    'Toys & Games': ['toy', 'puzzle', 'board game', 'rubik', 'fidget', 'spinner', 'lego', 'doll', 'action figure'],
    'Daily Use': ['drawing tablet', 'tablet stand', 'desk', 'organizer', 'storage', 'holder', 'stand', 'mount', 'case', 'cover', 'protector']
  };

  // First, try keyword matching
  for (const [category, keywords] of Object.entries(categoryKeywords)) {
    for (const keyword of keywords) {
      if (nameLower.includes(keyword)) {
        const existingMatch = existingCategories.find(c => c.toLowerCase() === category.toLowerCase());
        return existingMatch || category;
      }
    }
  }

  // Then try to match against existing categories, but SKIP brand-named categories
  for (const cat of existingCategories) {
    if (isBrand(cat)) continue;
    const catLower = cat.toLowerCase();
    if (nameLower.includes(catLower) || catLower.split(' ').some(word => word.length > 3 && nameLower.includes(word))) {
      return cat;
    }
  }

  return 'General';
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

    // 3. Process rows
    const results = [];
    await ensureCategoriesTable();
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
        // Auto-categorize (brand-aware)
        const category = autoCategorizeName(productName, existingCategories);

        // Auto-detect brand from product name
        const detectedBrand = detectBrand(productName);

        // Create category if it doesn't exist
        if (!existingCategories.includes(category)) {
          await db.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [category]);
          existingCategories.push(category);
        }

        // Scrape images AND price from the product link
        let imageUrls = [];
        let scrapedPriceFromLink = 0;
        if (link && link.trim() && (link.trim().startsWith('http://') || link.trim().startsWith('https://'))) {
          console.log(`[Bulk Upload] Scraping data for: ${productName} from ${link}`);
          const scraped = await scrapeProductData(link.trim());
          scrapedPriceFromLink = scraped.price || 0;

          // Download and upload each image to S3
          for (let j = 0; j < scraped.images.length; j++) {
            const imgBuffer = await downloadImage(scraped.images[j]);
            if (imgBuffer && imgBuffer.length > 2000) { // Skip small images/logos (must be >2KB)
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
        const safeCat = category || 'Uncategorized';
        await db.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [safeCat]);

        const insertResult = await db.query(
          'INSERT INTO products (name, description, price_vc, original_price, delivery_location, delivery_time, image_url, category, brand, stock, is_new_arrival) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
          [productName, '', finalPrice, scrapedPriceFromLink > 0 ? scrapedPriceFromLink : null, 'Alliance University', '7 Days', mainImage, safeCat, detectedBrand, 100, false]
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// POST /api/products/scrape-link
// Scrape product data from a single link (for "Add by Link" feature)
// Returns: { title, price, images[], imageUrls[] }
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
router.post('/scrape-link', verifyToken, isAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !url.trim()) {
      return res.status(400).json({ message: 'URL is required' });
    }

    console.log(`[Scrape Link] Scraping: ${url}`);
    await ensureCategoriesTable();
    const scraped = await scrapeProductData(url.trim(), 4);

    // Download and upload images to S3
    const s3ImageUrls = [];
    for (let j = 0; j < scraped.images.length; j++) {
      try {
        const imgBuffer = await downloadImage(scraped.images[j]);
        if (imgBuffer && imgBuffer.length > 2000) {
          const ext = scraped.images[j].match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] || 'jpg';
          const filename = `${uuidv4()}.${ext}`;
          const s3Url = await uploadBufferToS3(imgBuffer, `image/${ext}`, filename);
          s3ImageUrls.push(s3Url);
        }
      } catch (imgErr) {
        console.error(`[Scrape Link] Failed to download/upload image ${j}:`, imgErr.message);
      }
    }

    // Auto-detect category and brand
    const catResult = await db.query('SELECT name FROM categories ORDER BY name ASC');
    const existingCategories = catResult.rows.map(r => r.name);
    
    const suggestedCategory = scraped.category || autoCategorizeName(scraped.title, existingCategories);
    const detectedBrand = detectBrand(scraped.title);

    console.log(`[Scrape Link] ✅ Title: "${scraped.title}" | Price: ₹${scraped.price} | Category: ${suggestedCategory} | Brand: ${detectedBrand} | Images: ${s3ImageUrls.length}`);

    res.json({
      title: scraped.title || '',
      price: scraped.price || 0,
       category: suggestedCategory,
      brand: detectedBrand,
      originalImages: scraped.images,
      imageUrls: s3ImageUrls,
    });

  } catch (err) {
    console.error('[Scrape Link] Error:', err);
    res.status(500).json({ message: 'Failed to scrape link: ' + err.message });
  }
});

module.exports = router;

