const stripTrailingUrlJunk = (value: string): string =>
  value.trim().replace(/[)\],;，；。]+$/g, '').trim();

export const normalizeUrl = (url: string): string => {
  if (!url) return url;
  
  // 1. Remove invisible characters and trim
  let normalized = url
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/&amp;/gi, '&')
    .replace(/&#38;/g, '&')
    .trim();
  
  // 2. Remove surrounding quotes (handles cases where the whole field is quoted)
  normalized = stripTrailingUrlJunk(normalized.replace(/^["']|["']$/g, ''));

  // 2.5. If the string contains a URL but also other text, try to extract just the URL
  // This handles cases like "prompt text https://example.com/video.mp4"
  if (!normalized.startsWith('http') && normalized.includes('http')) {
    const urlMatches = normalized.match(/https?:\/\/[^\s"'<>]+/g);
    if (urlMatches && urlMatches.length > 0) {
      normalized = stripTrailingUrlJunk(urlMatches[urlMatches.length - 1]);
    }
  }

  // 3. Check for concatenated URLs (Symptom of CSV parsing failure)
  // If we find multiple http(s) protocols, try to extract the last one
  // because in a merged row, the model output URLs usually come last.
  const allUrls = normalized.match(/https?:\/\/[^\s"'<>]+/g);
  if (allUrls && allUrls.length > 1) {
    // Use the last one as it's most likely the intended URL for this slot
    normalized = stripTrailingUrlJunk(allUrls[allUrls.length - 1]);
  }

  normalized = stripTrailingUrlJunk(normalized);

  // 4. Handle protocol-relative URLs
  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  // 5. Handle Google Drive URLs
  if (normalized.includes('drive.google.com/file/d/')) {
    const match = normalized.match(/file\/d\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/uc?id=${match[1]}`;
    }
  }

  // 6. Handle Google Cloud Storage URLs
  if (normalized.startsWith('gs://')) {
    return normalized.replace('gs://', 'https://storage.googleapis.com/');
  }

  // 7. Handle AWS S3 URLs
  if (normalized.startsWith('s3://')) {
    const parts = normalized.substring(5).split('/');
    const bucket = parts.shift();
    const key = parts.join('/');
    return `https://${bucket}.s3.amazonaws.com/${key}`;
  }

  // 8. If it doesn't start with a known protocol, check if it's a URL or a prompt
  if (!normalized.match(/^(https?:\/\/|data:|blob:|ftp:\/\/|mailto:|tel:)/i)) {
    // If it contains spaces and no dots, it's probably a prompt, not a URL.
    // Don't prepend https:// to prompts!
    if (normalized.includes(' ') && !normalized.includes('.')) {
      return normalized; 
    }
    
    // If it looks like a domain or path, prepend https://
    if (normalized.includes('.') || normalized.includes('/')) {
      return `https://${normalized}`;
    }
    
    return normalized;
  }

  // 9. Upgrade HTTP to HTTPS (except for localhost)
  if (normalized.startsWith('http://') && !normalized.includes('localhost') && !normalized.includes('127.0.0.1')) {
    return normalized.replace('http://', 'https://');
  }

  return normalized;
};
