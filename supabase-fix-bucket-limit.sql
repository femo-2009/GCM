-- Run this in Supabase Dashboard → SQL Editor to increase the bucket file size limit
UPDATE storage.buckets
SET file_size_limit = 2147483648
WHERE id = 'media';
