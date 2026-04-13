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

// ─── Helper: Scrape Product Images from Any Site ───
async function scrapeProductImages(url, maxImages = 4) {
  const images = [];
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    const html = await response.text();
    const $ = cheerio.load(html);

    // 1. Check for standard JSON-LD Schema (works on Myntra, Flipkart, etc. if available in HTML)
    let schemaImages = [];
    $('script[type="application/ld+json"]').each((i, el) => {
      try {
        const data = JSON.parse($(el).html());
        if (data && Array.isArray(data)) {
          data.forEach(item => {
            if (item['@type'] === 'Product' && item.image) {
              if (Array.isArray(item.image)) schemaImages.push(...item.image);
              else if (typeof item.image === 'string') schemaImages.push(item.image);
            }
          });
        } else if (data && data['@type'] === 'Product' && data.image) {
          if (Array.isArray(data.image)) schemaImages.push(...data.image);
          else if (typeof data.image === 'string') schemaImages.push(data.image);
        }
      } catch (e) { }
    });
    
    // Add schema images first
    schemaImages.forEach(img => {
      if (img && !images.includes(img) && images.length < maxImages) images.push(img);
    });

    // 2. Amazon Specific Logic (data-a-dynamic-image)
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

    // 3. Open Graph (og:image) - Usually the main high-res image
    if (images.length < maxImages) {
      const ogImage = $('meta[property="og:image"]').attr('content');
      if (ogImage && !images.includes(ogImage)) images.push(ogImage);
    }

    // 4. Flipkart / Myntra / Generic Image Selectors
    if (images.length < maxImages) {
      // Find all large images that look like product images
      $('img').each((i, el) => {
        if (images.length >= maxImages) return;
        let src = $(el).attr('src') || $(el).attr('data-src') || '';
        
        // Amazon thumbnail resolution fix
        src = src.replace(/\._[^.]*_\./, '.');
        
        // Filter out tiny icons, logos, sprites
        const classNames = ($(el).attr('class') || '').toLowerCase();
        if (src && src.startsWith('http') && 
            !src.includes('logo') && 
            !src.includes('icon') && 
            !src.includes('sprite') && 
            !images.includes(src)) {
            
            // If it's a known ecom class or a very large image URL pattern
            if (classNames.includes('product') || classNames.includes('image') || src.includes('imageright') || src.includes('image1')) {
                images.push(src);
            }
        }
      });
    }

    // 5. Fallback: Any generic main image
    if (images.length === 0) {
      const mainImg = $('#landingImage').attr('src') || $('#imgBlkFront').attr('src') || $('.product-image img').attr('src');
      if (mainImg) images.push(mainImg);
    }

  } catch (err) {
    console.error(`Error scraping URL ${url}:`, err.message);
  }
  return images.slice(0, maxImages);
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

      const priceVc = parseInt(priceRaw) || 0;

      try {
        // Auto-categorize
        const category = autoCategorizeName(productName, existingCategories);

        // Create category if it doesn't exist
        if (!existingCategories.includes(category)) {
          await db.query('INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [category]);
          existingCategories.push(category);
        }

        // Scrape images from Amazon link
        let imageUrls = [];
        if (link && link.trim()) {
          console.log(`[Bulk Upload] Scraping images for: ${productName} from ${link}`);
          const scrapedImages = await scrapeProductImages(link.trim());

          // Download and upload each image to S3
          for (let j = 0; j < scrapedImages.length; j++) {
            const imgBuffer = await downloadImage(scrapedImages[j]);
            if (imgBuffer && imgBuffer.length > 1000) { // Skip tiny/broken images
              const ext = scrapedImages[j].match(/\.(jpg|jpeg|png|webp|gif)/i)?.[1] || 'jpg';
              const filename = `${uuidv4()}.${ext}`;
              const s3Url = await uploadBufferToS3(imgBuffer, `image/${ext}`, filename);
              imageUrls.push(s3Url);
            }
          }
        }

        const mainImage = imageUrls.length > 0 ? imageUrls[0] : '';

        // Insert product
        const insertResult = await db.query(
          'INSERT INTO products (name, description, price_vc, original_price, delivery_location, delivery_time, image_url, category, brand, stock, is_new_arrival) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
          [productName, '', priceVc, null, 'Alliance University', '7 Days', mainImage, category, '', 100, false]
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
          price: priceVc,
          category,
          images: imageUrls.length,
          status: 'success'
        });

        console.log(`[Bulk Upload] ✅ Added: ${productName} | ${priceVc} VC | ${category} | ${imageUrls.length} images`);

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
    columns: ['ProductName', 'Price', 'Link'],
    example: [
      { ProductName: 'boAt Rockerz 450 Bluetooth Headphone', Price: 1500, Link: 'https://www.amazon.in/dp/B07SZG2FHN' },
      { ProductName: 'Cello Butterflow Ball Pen Pack', Price: 200, Link: 'https://www.amazon.in/dp/B08YKDLKFK' }
    ],
    instructions: 'Create an Excel file (.xlsx) with exactly 3 columns: ProductName, Price, Link. Price is in VCs (just the number). Link should be the full e-commerce product URL (Amazon, Flipkart, Meesho, Myntra, etc).'
  });
});

module.exports = router;
