import fs from 'node:fs';
import { createDb } from '../packages/db/src/db.js';
import { normalizeReviewProduct } from '../packages/db/src/product-review-product.js';

const { pool } = createDb();
const connection = await pool.getConnection();
try {
  await connection.query('SET SESSION lock_wait_timeout=10');
  const [columns]: any = await connection.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_reviews' AND COLUMN_NAME IN ('review_item_id','review_item_name','review_item_image_url','review_features')");
  if (!columns.length) await connection.query(fs.readFileSync('packages/db/migrations/0051_product_review_product_fields.sql', 'utf8'));
  else if (columns.length !== 4) throw new Error('Partial migration: inspect product review columns before proceeding');
  const [rows]: any = await connection.query('SELECT id,raw_payload FROM product_reviews');
  await connection.beginTransaction();
  for (const row of rows) {
    const product = normalizeReviewProduct(row.raw_payload);
    await connection.query('UPDATE product_reviews SET review_item_id=COALESCE(review_item_id,?),review_item_name=COALESCE(review_item_name,?),review_item_image_url=COALESCE(review_item_image_url,?),review_features=COALESCE(review_features,?) WHERE id=?', [product.itemId, product.name, product.imageUrl, JSON.stringify(product.features), row.id]);
  }
  await connection.commit();
  const [counts] = await connection.query('SELECT COUNT(*) total,SUM(review_item_id IS NOT NULL) withItemId,SUM(review_item_name IS NOT NULL) withName,SUM(review_item_image_url IS NOT NULL) withImage,SUM(JSON_LENGTH(review_features)>0) withFeatures FROM product_reviews');
  console.log(JSON.stringify({ processed: rows.length, counts }));
} catch (error) {
  await connection.rollback();
  console.error(error);
  connection.release();
  process.exit(1);
}
connection.release();
process.exit(0);
