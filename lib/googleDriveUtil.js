const { Dropbox } = require('dropbox');
const fs = require('fs');
const { createTableIfNotExists, insertFile, listFiles, pool } = require('./database');
const axios = require('axios');
const chalk = require('chalk')
const { Pool } = require('pg');
const { Buffer } = require('buffer');
const DROPBOX_VIDEO = '/Videos';  // Specify the folder path in Dropbox
const DROPBOX_ZIP = '/Zips'
// Initialize Dropbox with the token from environment variables
function initializeDropbox(token) {
    if (!token) {
        throw new Error('Dropbox token is missing.');
    }
    return new Dropbox({ accessToken: token });
}

// Validate Dropbox Token
const validateTokenScopes = async (dropbox) => {
    try {
        const response = await dropbox.usersGetCurrentAccount();
        if (!response) {
            throw new Error('Unable to validate token. Please check your token.');
        }      
    } catch (error) {
        console.error('Token validation failed:', error.message);
        throw new Error('Invalid or expired access token. Please generate a new token with the correct scopes.');
    }
};

// Ensure folder exists in Dropbox
const ensureFolderExists = async (folderPath, dropbox) => {
    try {
        await dropbox.filesGetMetadata({ path: folderPath });
    } catch (error) {
        if (error.error?.error_summary?.startsWith('path/not_found')) {
            await dropbox.filesCreateFolderV2({ path: folderPath });
        } else {
            console.error('Error ensuring folder existence:', error.message);
            throw error;
        }
    }
};

// Upload file to Dropbox
const uploadFileToDropbox = async (folderPath, fileName, fileBuffer, dropbox) => {
    try {
        await validateTokenScopes(dropbox); // Ensure valid token
        await ensureFolderExists(folderPath, dropbox); // Ensure the folder exists

        await dropbox.filesUpload({
            path: `${folderPath}/${fileName}`,
            contents: fileBuffer,
            mode: { '.tag': 'add' }, // Add a unique suffix if file with the same name exists
        });
    } catch (error) {
        console.error('Error uploading file to Dropbox:', error.message);
        throw error;
    }
};


// Delete file from Dropbox
const deleteFileFromDropbox = async (folderPath, fileName, dropbox) => {
  try {
      await validateTokenScopes(dropbox);
    await dropbox.filesDeleteV2({ path: `${folderPath}/${fileName}` });
  } catch (error) {
    console.error('Error deleting file from Dropbox:', error.message);
    throw error;
  }
};

// Delete file record from the database
const deleteFileFromDatabase = async (videoName) => {
  const query = 'DELETE FROM mediaonly WHERE name = $1 AND type = $2;';
  await pool.query(query, [videoName, 'video']);
};


// Add a video file (uploads to Dropbox if >20MB)
exports.addvideo = async (videoName, fileBuffer) => {
    videoName = videoName.trim();
    await createTableIfNotExists();
try {
  // Check if zip file size exceeds 20 MB (20 * 1024 * 1024 bytes)
    const fileSize = fileBuffer.length;
    const storageLocation = fileSize > 20 * 1024 * 1024 ? 'dropbox' : 'database';

     // If the file size exceeds 20 MB, upload to Dropbox and save a reference in the database
        const fileName = `${videoName}.mp4`;
    if (storageLocation === 'dropbox') {
      const dropbox = initializeDropbox(process.env.DROPBOX_TOKEN);
      await uploadFileToDropbox(DROPBOX_VIDEO, fileName, fileBuffer, dropbox);
    }

    // Insert file into the database with the appropriate storage location (Dropbox or Database)

    await insertFile(videoName, fileBuffer, 'video', storageLocation);
    
    return `Video "${videoName}" added successfully to the ${storageLocation === 'dropbox' ? 'Dropbox' : 'database'}.`;
  } catch (error) {
    console.error('Error in addzip function:', error.message);
    throw error;
  }
};

// List all videos
exports.listvideos = async () => {
  return await listFiles('video');
};


exports.getvideo = async (videoName) => {
    videoName = videoName.trim();
    await createTableIfNotExists();

    const query = 'SELECT file_data, storage_location FROM mediaonly WHERE name = $1 AND type = $2;';
    const res = await pool.query(query, [videoName, 'video']);

    if (res.rows.length === 0) {
        throw new Error('The video does not exist in the database.');
    }

    const { file_data, storage_location } = res.rows[0];

    if (storage_location.trim() === 'dropbox') {
        const dropbox = initializeDropbox(process.env.DROPBOX_TOKEN);

        // Validate Dropbox Token
        await validateTokenScopes(dropbox);

        const dropboxPath = `${DROPBOX_VIDEO}/${videoName.endsWith('.mp4') ? videoName : videoName + '.mp4'}`;

        try {
            const metadata = await dropbox.filesGetMetadata({ path: dropboxPath });
            const response = await dropbox.filesDownload({ path: dropboxPath });
            return {
                videoBuffer: Buffer.from(response.result.fileBinary),
                caption: `Here is the video: ${videoName} (retrieved from Dropbox)`,
            };
        } catch (error) {
            console.error("Error fetching video from Dropbox:", error);
            throw new Error(`File "${videoName}" not found in Dropbox.`);
        }
    } else if (file_data) {
        return {
            videoBuffer: file_data,
            caption: `Here is the video: ${videoName}`,
        };
    } else {
        throw new Error('The video data is missing from the database.');
    }
};
// Delete a video file
exports.delvideo = async (videoName) => {
    videoName = videoName.trim();
    await createTableIfNotExists();

    const queryy = 'SELECT storage_location FROM mediaonly WHERE name = $1 AND type = $2;';
    const res = await pool.query(queryy, [videoName, 'video']);

    if (res.rows.length === 0) {
        throw new Error('The video does not exist in the database.');
    }

    const storage_location = res.rows[0].storage_location.trim(); 

    try {
        if (storage_location === 'dropbox') {
            const dropbox = initializeDropbox(process.env.DROPBOX_TOKEN);
             // Ensure videoName ends with .mp4
        const formattedVideoName = videoName.endsWith('.mp4') ? videoName : `${videoName}.mp4`;
            await deleteFileFromDropbox(DROPBOX_VIDEO, formattedVideoName, dropbox);
        }

        // Delete video from the database
        await pool.query('DELETE FROM mediaonly WHERE name = $1 AND type = $2;', [videoName, 'video']);

        return `Video "${videoName}" has been deleted successfully.`;
    } catch (error) {
        console.error('Error deleting video:', error.message);
        throw error;
    }
};
// Add a zip file (with Dropbox upload if the file size exceeds 20MB)
exports.addzip = async (zipName, zipBuffer) => {
    zipName = zipName.trim();
  await createTableIfNotExists();

  try {
    // Check if zip file size exceeds 20 MB (20 * 1024 * 1024 bytes)
    const fileSize = zipBuffer.length;
    const storageLocation = fileSize > 1 * 1024 * 1024 ? 'dropbox' : 'database';

    // If the file size exceeds 20 MB, upload to Dropbox and save a reference in the database
    if (storageLocation === 'dropbox') {
      const dropbox = initializeDropbox(process.env.DROPBOX_TOKEN);
      await uploadFileToDropbox(DROPBOX_ZIP, zipName, zipBuffer, dropbox);
    }

    // Insert file into the database with the appropriate storage location (Dropbox or Database)
    await insertFile(zipName, zipBuffer, 'zip', storageLocation);
    
    return `Zip file "${zipName}" added successfully to the ${storageLocation === 'dropbox' ? 'Dropbox' : 'database'}.`;
  } catch (error) {
    console.error('Error in addzip function:', error.message);
    throw error;
  }
};

// List all zip files
exports.listzip = async () => {
  await createTableIfNotExists();
  return await listFiles('zip');
};

// Get a zip file (retrieves from database or Dropbox)
exports.getzip = async (zipName) => {
    zipName = zipName.trim();
  await createTableIfNotExists();

  const queryy = 'SELECT file_data, storage_location FROM mediaonly WHERE name = $1 AND type = $2;';
  const res = await pool.query(queryy, [zipName, 'zip']);

  if (res.rows.length === 0) {
    throw new Error('The zip file does not exist in the database.');
  }

  const { file_data, storage_location } = res.rows[0];

  if (storage_location === 'dropbox') {
    const dropbox = initializeDropbox(process.env.DROPBOX_TOKEN);
   const dropboxPath = `${DROPBOX_ZIP}/${zipName}`; // Correct path
const response = await dropbox.filesDownload({ path: dropboxPath });

    // Return the video as a buffer (not as a stream)
    return {
       zipBuffer: Buffer.from(response.result.fileBinary),
      caption: `Here is the zip: ${zipName} (retrieved from Dropbox)`,
    };

  } else {
    return {
      zipBuffer: file_data,
      caption: `Here is the zip file: ${zipName}`,
    };
  }
};

// Delete a zip file (removes from database and Dropbox if needed)
exports.delzip = async (zipName) => {
    zipName = zipName.trim();
  await createTableIfNotExists();

  const queryy = 'SELECT storage_location FROM mediaonly WHERE name = $1 AND type = $2;';
  const res = await pool.query(queryy, [zipName, 'zip']);

  if (res.rows.length === 0) {
    throw new Error('The zip file does not exist in the database.');
  }

  const { storage_location } = res.rows[0];

  try {
    if (storage_location === 'dropbox') {
      const dropbox = initializeDropbox(process.env.DROPBOX_TOKEN);
      await deleteFileFromDropbox(DROPBOX_ZIP, zipName, dropbox);
    }

    await deleteFileFromDatabase(zipName);
    return `Zip file "${zipName}" has been deleted successfully.`;
  } catch (error) {
    console.error('Error deleting zip file:', error.message);
    throw error;
  }
};


let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})