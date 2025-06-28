const ytsr = require('ytsr');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// YouTube Search
const ytsearch = async (text) => {
  try {
    const filters = await ytsr.getFilters(text);
    const videoFilter = filters.get('Type').get('Video');
    const searchResults = await ytsr(videoFilter.url, { limit: 10 });
    const results = searchResults.items;

    if (results.length === 0) throw new Error('No search results found.');

    const push = results.map((video, i) => {
      const cap = `Title: ${video.title}\nViews: ${video.views}\nDuration: ${video.duration}\nUploaded: ${video.uploadedAt}\nLink: ${video.url}`;
      const thumbnailUrl = video.bestThumbnail.url;

      return {
        body: proto.Message.InteractiveMessage.Body.fromObject({ text: cap }),
        header: proto.Message.InteractiveMessage.Header.create({
          title: `Result ${i + 1}`,
          hasMediaAttachment: true,
          ...mediaMessage,
        }),
        nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
          buttons: [
            { name: 'cta_url', buttonParamsJson: `{"display_text":"View on Youtube🌹","url":"${video.url}"}` },
            { name: 'quick_reply', buttonParamsJson: `{"display_text":"Download Video","id":"${prefix}ytdownload ${video.url}"}` },
            { name: 'quick_reply', buttonParamsJson: `{"display_text":"Download Audio","id":"${prefix}ytaudio ${video.url}"}` },
          ],
        }),
      };
    });

    return push;
  } catch (error) {
    throw new Error('Failed to fetch YouTube search results.');
  }
};

// YouTube Video Download
const ytvideo = async (url, text) => {
  const tempDir = './tmp';
  const videoTitle = text || 'Unknown Title';
  const tempVideoPath = path.join(tempDir, `${videoTitle}.mp4`);
  
  try {
    await youtubedl(url, {
      output: tempVideoPath,
      format: 'best[height<=1080][ext=mp4]',
      cookies: './cookies/youtube_cookies.txt',
    });

    if (!fs.existsSync(tempVideoPath)) throw new Error('Failed to download the video.');

    const videoStats = fs.statSync(tempVideoPath);

    if (videoStats.size > 80 * 1024 * 1024) {
      const zipFilePath = path.join(tempDir, `${videoTitle}.zip`);
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.pipe(output);
      archive.file(tempVideoPath, { name: `${videoTitle}.mp4` });
      await archive.finalize();

      await new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
      });

      return zipFilePath;
    } else {
      return tempVideoPath;
    }
  } catch (error) {
    throw new Error('Error downloading or processing the video.');
  }
};

// YouTube Audio Download
const ytaudio = async (url, text) => {
  const tempDir = './tmp';
  const audioTitle = text || 'Unknown Title';
  const sanitizedTitle = audioTitle.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
  const tempAudioPath = path.join(tempDir, `${sanitizedTitle}.mp3`);

  try {
    await youtubedl(url, {
      output: tempAudioPath,
      format: 'bestaudio[ext=m4a]',
      cookies: './cookies/youtube_cookies.txt',
    });

    if (!fs.existsSync(tempAudioPath)) throw new Error('Failed to download the audio.');

    const audioStats = fs.statSync(tempAudioPath);

    if (audioStats.size > 80 * 1024 * 1024) {
      const zipFilePath = path.join(tempDir, `${audioTitle}.zip`);
      const output = fs.createWriteStream(zipFilePath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      archive.pipe(output);
      archive.file(tempAudioPath, { name: `${audioTitle}.mp3` });
      await archive.finalize();

      await new Promise((resolve, reject) => {
        output.on('close', resolve);
        archive.on('error', reject);
      });

      return zipFilePath;
    } else {
      return tempAudioPath;
    }
  } catch (error) {
    throw new Error('Error downloading or processing the audio.');
  }
};

module.exports = { ytsearch, ytvideo, ytaudio };
