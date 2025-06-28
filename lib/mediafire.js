const { tikdown, ytdown, twitterdown, fbdown2, GDLink, capcut, likee, threads, ndown, alldown, geturl, axios, key } = require('./logs')
const request = require('request')

// Helper function to check if data contains valid URLs
const hasValidUrls = (data) => {
  if (!data) return false;
  
  // Check for direct video URL
  if (data.video && typeof data.video === 'string') return true;
  
  // Check for data.data structure
  if (data.data) {
    if (Array.isArray(data.data) && data.data.length > 0) return true;
    if (data.data.video && typeof data.data.video === 'string') return true;
    if (data.data.images && Array.isArray(data.data.images) && data.data.images.length > 0) return true;
  }
  
  // Check for images at root level
  if (data.images && Array.isArray(data.images) && data.images.length > 0) return true;
  
  return false;
}

exports.savefrom = async (mediaUrl) => {
  try {
    const platform = geturl(mediaUrl);
    
    let data;
    
    switch (platform) {
      case 'instagram':
        data = await ndown(mediaUrl);
        // Fallback for Instagram if no URLs found
        if (!data || !hasValidUrls(data)) {
          data = await ndown(mediaUrl); // Try ndown again as fallback
        }
        break;
      case 'tiktok':
        data = await tikdown(mediaUrl);
        break;
      case 'youtube':
        data = await ytdown(mediaUrl);
        break;
      case 'twitter':
        data = await twitterdown(mediaUrl);
        break;
      case 'facebook':
        data = await ndown(mediaUrl);
        // Fallback for Facebook if no URLs found
        if (!data || !hasValidUrls(data)) {
          try {
            data = await ndown(mediaUrl); // Try ndown again
          } catch (error) {
            // If ndown fails, try fbdown2 as second fallback
            data = await fbdown2(mediaUrl, key);
          }
        }
        break;
      case 'gdrive':
        data = await GDLink(mediaUrl);
        break;
      case 'capcut':
        data = await capcut(mediaUrl);
        break;
      case 'likee':
        data = await likee(mediaUrl);
        break;
      case 'threads':
        data = await threads(mediaUrl);
        break;
      default:
        data = await alldown(mediaUrl);
        break;
    }
    
    const buffers = { video: [], image: [] };
    
    if (data) {
      let urlsToProcess = [];
      let title = 'No media';
      
      // Handle different data structures based on platform
      let mediaData = data.data || data; // Use data.data if exists, otherwise use data directly
      
      // Extract title from various possible locations
      title = data.title || data.data?.title || data.data?.caption || data.data?.fileName || data.author || 'No media';
      
      // Handle array of media URLs (for platforms that return arrays)
      if (Array.isArray(mediaData)) {
        const numUrlsToProcess = Math.ceil(Math.sqrt(mediaData.length));
        urlsToProcess = mediaData.slice(0, numUrlsToProcess);
      }

      // Handle direct video URL (like TikTok)
      if (data.video && typeof data.video === 'string') {
        urlsToProcess.push({ url: data.video });
      }
      // Handle case where data.data.video contains a single video URL (only if we haven't already added from data.video)
      else if (mediaData.video && typeof mediaData.video === 'string' && mediaData.video.includes('mime_type=video_mp4')) {
        urlsToProcess.push({ url: mediaData.video });
      }

      // Process images if present (check both data.images and data.data.images)
      const images = data.images || mediaData.images;
      if (images && Array.isArray(images)) {
        for (const imgUrl of images) {
          if (imgUrl.includes('jpeg') || imgUrl.includes('jpg') || imgUrl.includes('png')) {
            try {
              const response = await axios.get(imgUrl, { responseType: 'arraybuffer' });
              buffers.image.push(Buffer.from(response.data));
            } catch (error) {
              // Skip failed image downloads
            }
          }
        }
      }
      
      // Check if we have any URLs to process
      if (urlsToProcess.length === 0) {
        throw new Error('No valid media URLs found in the response.');
      }
      
      // Process each URL
      for (const post of urlsToProcess) {
        const url = post.url || post; // Handle both object and string formats
        
        try {
          const response = await axios.get(url, { responseType: 'arraybuffer' });

          // Enhanced detection for video content
          if (url.includes('mime_type=video_mp4') || 
              url.startsWith('https://d.rapidcdn') ||
              url.includes('tiktokcdn.com') ||
              url.includes('.mp4') ||
              url.includes('video')) {
            buffers.video.push(Buffer.from(response.data));

          } else if (url.startsWith('https://scontent') ||
                     url.includes('.jpg') ||
                     url.includes('.jpeg') ||
                     url.includes('.png') ||
                     url.includes('image')) {
            buffers.image.push(Buffer.from(response.data));

          } else {
            buffers.video.push(Buffer.from(response.data));
          }
        } catch (error) {
          // Skip failed downloads
        }
      }
      
      const result = { buffers, title };
      return result;
    }
    
    throw new Error('No valid media URLs found in the response.');
    
  } catch (error) {
    throw new Error(error.message);
  }
};