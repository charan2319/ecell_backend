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

// ─── Helper: Scrape Product Data (Title + Images + Price) from Any Site ───
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
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
      },
      redirect: 'follow',
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    // ━━━━━━━ TITLE SCRAPING ━━━━━━━
    // 1. JSON-LD Schema title
    $('script[type="application/ld+json"]').each((i, el) => {
      if (scrapedTitle) return;
      try {
        const data = JSON.parse($(el).html());
        const extractTitle = (item) => {
          if (item && item['@type'] === 'Product' && item.name) return item.name;
          return '';
        };
        if (Array.isArray(data)) {
          for (const item of data) { const t = extractTitle(item); if (t) { scrapedTitle = t; break; } }
        } else {
          scrapedTitle = extractTitle(data);
          if (!scrapedTitle && data['@graph']) {
            for (const item of data['@graph']) { const t = extractTitle(item); if (t) { scrapedTitle = t; break; } }
          }
        }
      } catch (e) { }
    });

    // 2. Amazon-specific title
    if (!scrapedTitle) {
      scrapedTitle = $('#productTitle').text().trim() || '';
    }

    // 3. Flipkart-specific title
    if (!scrapedTitle) {
      scrapedTitle = $('.B_NuCI').text().trim() || $('span.VU-ZEz').text().trim() || '';
    }

    // 4. og:title / meta title fallback
    if (!scrapedTitle) {
      scrapedTitle = $('meta[property="og:title"]').attr('content') || $('meta[name="title"]').attr('content') || $('title').text().trim() || '';
    }

    // Clean up title - remove site name suffixes
    scrapedTitle = scrapedTitle
      .replace(/\s*[-|:]\s*(Amazon\.in|Amazon|Flipkart|Myntra|Meesho|Buy Online).*$/i, '')
      .replace(/\s*:\s*Buy\s+Online.*$/i, '')
      .replace(/\s*\|\s*Free Shipping.*$/i, '')
      .trim();

    console.log(`[Scraper] Title found: "${scrapedTitle}" from ${url}`);

    // ━━━━━━━ PRICE SCRAPING ━━━━━━━

    // 1. JSON-LD Schema price (most reliable — works on Amazon, Flipkart, Myntra, etc.)
    $('script[type="application/ld+json"]').each((i, el) => {
      if (scrapedPrice > 0) return;
      try {
        const data = JSON.parse($(el).html());
        const extractPrice = (item) => {
          if (!item) return 0;
          if (item.offers) {
            const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
            for (const offer of offers) {
              const p = parseFloat(offer.price || offer.lowPrice || offer.highPrice || 0);
              if (p > 0) return Math.round(p);
              // Check nested offer within AggregateOffer
              if (offer['@type'] === 'AggregateOffer') {
                const lp = parseFloat(offer.lowPrice || offer.highPrice || 0);
                if (lp > 0) return Math.round(lp);
              }
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
        '.priceToPay .a-offscreen',
        '#corePrice_feature_div .a-offscreen',
        '#corePriceDisplay_desktop_feature_div .a-offscreen',
        '.a-price .a-offscreen',
        '#priceblock_dealprice',
        '#priceblock_ourprice',
        '#priceblock_saleprice',
        '.a-price-whole',
        '#apex_desktop .a-offscreen',
        '#tp_price_block_total_price_ww .a-offscreen',
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
        '._30jeq3', '.Nx9bqj._4b5DiR', '.CEmiEU div._30jeq3',
        '._16Jk6d', '.Nx9bqj',
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

    // 4. Myntra / Meesho selectors
    if (scrapedPrice === 0) {
      const otherSelectors = [
        '.pdp-price strong', '.pdp-discount-container .pdp-price',
        '[class*="ProductPrice"]', '[class*="DiscountedPrice"]',
      ];
      for (const selector of otherSelectors) {
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

    // 5. og:price / product:price meta tags
    if (scrapedPrice === 0) {
      const priceMetas = [
        $('meta[property="og:price:amount"]').attr('content'),
        $('meta[property="product:price:amount"]').attr('content'),
        $('meta[name="twitter:data1"]').attr('content'),
        $('meta[name="twitter:data2"]').attr('content'),
        $('meta[itemprop="price"]').attr('content'),
        $('[itemprop="price"]').attr('content'),
        $('[itemprop="price"]').text().trim(),
      ];
      for (const metaPrice of priceMetas) {
        if (!metaPrice) continue;
        const match = metaPrice.replace(/[₹,\s]/g, '').match(/[\d.]+/);
        if (match) {
          const p = parseFloat(match[0]);
          if (p > 0) { scrapedPrice = Math.round(p); break; }
        }
      }
    }

    // 6. Generic fallback: look for ₹ or Rs. followed by a number
    if (scrapedPrice === 0) {
      const priceContainers = [
        '[class*="price"]', '[class*="Price"]', '[class*="PRICE"]',
        '[id*="price"]', '[id*="Price"]',
        '[class*="cost"]', '[class*="amount"]', '[class*="selling"]',
      ];
      for (const selector of priceContainers) {
        $(selector).each((i, el) => {
          if (scrapedPrice > 0) return;
          const text = $(el).text();
          const match = text.match(/(?:₹|Rs\.?|INR)\s*([0-9,]+(?:\.\d{1,2})?)/);
          if (match) {
            const p = parseFloat(match[1].replace(/,/g, ''));
            if (p > 0 && p < 1000000) scrapedPrice = Math.round(p);
          }
        });
        if (scrapedPrice > 0) break;
      }
    }

    // 7. Last resort: scan entire HTML for price pattern
    if (scrapedPrice === 0) {
      const bodyText = $('body').text();
      const priceMatches = bodyText.match(/₹\s*([0-9,]+)/g);
      if (priceMatches && priceMatches.length > 0) {
        // Take the first reasonable price
        for (const pm of priceMatches) {
          const val = parseFloat(pm.replace(/[₹,\s]/g, ''));
          if (val > 50 && val < 500000) { scrapedPrice = Math.round(val); break; }
        }
      }
    }

    console.log(`[Scraper] Price found: ₹${scrapedPrice} from ${url}`);

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
      // Deduplicate by removing Amazon size suffixes for comparison
      const normalized = src.replace(/\._[A-Z]{2}\d+_\./, '.');
      if (images.some(existing => existing.replace(/\._[A-Z]{2}\d+_\./, '.') === normalized)) return false;
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

    // 2. Amazon: data-a-dynamic-image (main image with all variants)
    if (images.length < maxImages) {
      const dynamicImageEl = $('[data-a-dynamic-image]').first();
      if (dynamicImageEl.length) {
        try {
          const imgData = JSON.parse(dynamicImageEl.attr('data-a-dynamic-image'));
          // Sort by image dimensions (largest first)
          const urls = Object.entries(imgData).sort((a, b) => {
            const aSize = a[1][0] * a[1][1]; const bSize = b[1][0] * b[1][1];
            return bSize - aSize;
          }).map(e => e[0]);
          urls.forEach(u => addImage(u));
        } catch (e) { }
      }
    }

    // 3. Amazon: altImages / thumbnail strip (gets multiple product angles)
    if (images.length < maxImages) {
      $('#altImages img, #imageBlock img, .imageThumbnail img, li.image img').each((i, el) => {
        if (images.length >= maxImages) return;
        let src = $(el).attr('src') || $(el).attr('data-src') || '';
        // Convert Amazon thumbnails to high-res
        src = src.replace(/\._[A-Z]{2}\d+_\./, '.');
        src = src.replace(/\._S[A-Z]\d+_\./, '.');
        addImage(src);
      });
    }

    // 4. Flipkart: product image gallery
    if (images.length < maxImages) {
      // Flipkart thumbnail strip
      $('._2E1FGS img, ._3kidJX img, .CXW8mj img, ._1BweB8 img, ._2r_T1I img, ._396cs4 img, .q6DClP img').each((i, el) => {
        if (images.length >= maxImages) return;
        let src = $(el).attr('src') || $(el).attr('data-src') || '';
        // Flipkart: upgrade thumbnail to full-size (128 -> 416)
        src = src.replace(/\/128\/128\//g, '/416/416/');
        src = src.replace(/\/image\/128\//g, '/image/416/');
        addImage(src);
      });
    }

    // 5. Open Graph + Twitter + itemprop meta images
    if (images.length < maxImages) {
      const metaImgSelectors = [
        'meta[property="og:image"]', 'meta[property="og:image:secure_url"]',
        'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]',
        'meta[itemprop="image"]',
      ];
      metaImgSelectors.forEach(sel => {
        const content = $(sel).attr('content');
        if (content) addImage(content);
      });
    }

    // 6. Generic product containers
    if (images.length < maxImages) {
      const productContainers = [
        '#imgTagWrapperId', '.product-image', '.gallery-image', '.product-gallery',
        '.main-image', '[data-gallery]', '.slick-track', '.swiper-wrapper',
        '.woocommerce-product-gallery__image', '.product-main-image',
        '.pdp-image', '.product-detail-image', '[class*="ProductImage"]',
        '.image-grid', '.product-photos',
      ];
      productContainers.forEach(container => {
        $(container).find('img').each((i, el) => {
          if (images.length >= maxImages) return;
          let src = $(el).attr('src') || $(el).attr('data-src') || $(el).attr('data-zoom-image') || '';
          src = src.replace(/\._[A-Z]{2}\d+_\./, '.'); // Amazon hi-res fix
          const alt = ($(el).attr('alt') || '').toLowerCase();
          if (!alt.includes('logo') && !alt.includes('icon')) addImage(src);
        });
      });
    }

    // 7. Fallback exact IDs
    if (images.length === 0) {
      const fallbackIds = ['#landingImage', '#imgBlkFront', '#main-image', '.product-image img'];
      for (const sel of fallbackIds) {
        const src = $(sel).attr('src') || $(sel).attr('data-src') || '';
        if (addImage(src)) break;
      }
    }
    
    // 8. Deep fallback: scan page for large product-like images
    if (images.length === 0) {
      const allImgs = [];
      $('img').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        const alt = ($(el).attr('alt') || '').toLowerCase();
        const width = parseInt($(el).attr('width') || '0');
        const height = parseInt($(el).attr('height') || '0');
        if (src && src.startsWith('http') && !isLikelyBrandImage(src) && !alt.includes('logo') && !alt.includes('icon')) {
          // Score images: larger dimensions or product-like URLs get higher scores
          let score = 0;
          if (width > 200 || height > 200) score += 3;
          if (/\b\d{3,}x\d{3,}\b/.test(src)) score += 2;
          if (src.includes('product') || src.includes('large') || src.includes('zoom')) score += 2;
          if (alt.length > 15) score += 1;
          if (width > 50 && width < 100) score -= 2; // Thumbnails
          allImgs.push({ src, score });
        }
      });
      // Sort by score descending and take the best ones
      allImgs.sort((a, b) => b.score - a.score);
      for (const img of allImgs) {
        if (!addImage(img.src)) continue;
        if (images.length >= maxImages) break;
      }
    }

  } catch (err) {
    console.error(`Error scraping URL ${url}:`, err.message);
  }
  return { images: images.slice(0, maxImages), price: scrapedPrice, title: scrapedTitle };
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
        if (link && link.trim()) {
          console.log(`[Bulk Upload] Scraping data for: ${productName} from ${link}`);
          const scraped = await scrapeProductData(link.trim());
          scrapedPriceFromLink = scraped.price || 0;

          // Download and upload each image to S3
          for (let j = 0; j < scraped.images.length; j++) {
            const imgBuffer = await downloadImage(scraped.images[j]);
            if (imgBuffer && imgBuffer.length > 5000) { // Skip small images/logos (must be >5KB)
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
          [productName, '', finalPrice, scrapedPriceFromLink > 0 ? scrapedPriceFromLink : null, 'Alliance University', '7 Days', mainImage, category, detectedBrand, 100, false]
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
    const scraped = await scrapeProductData(url.trim(), 6);

    // Download and upload images to S3
    const s3ImageUrls = [];
    for (let j = 0; j < scraped.images.length; j++) {
      try {
        const imgBuffer = await downloadImage(scraped.images[j]);
        if (imgBuffer && imgBuffer.length > 5000) {
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
    
    const suggestedCategory = autoCategorizeName(scraped.title, existingCategories);
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

