//base by DGXeon
//re-upload? recode? copy code? give credit ya :)
//YouTube: @DGXeon
//Instagram: unicorn_xeon13
//Telegram: t.me/xeonbotinc
//GitHub: @DGXeon
//WhatsApp: +916909137213
//want more free bot scripts? subscribe to my youtube channel: https://youtube.com/@DGXeon

let axios = require('axios')
let BodyForm = require('form-data')
let { fromBuffer } = require('file-type')
let fetch = require('node-fetch')
let fs = require('fs')
let cheerio = require('cheerio')


function TelegraPh (Path) {
	return new Promise (async (resolve, reject) => {
		if (!fs.existsSync(Path)) return reject(new Error("File not Found"))
		try {
			const form = new BodyForm();
			form.append("file", fs.createReadStream(Path))
			const data = await  axios({
				url: "https://telegra.ph/upload",
				method: "POST",
				headers: {
					...form.getHeaders()
				},
				data: form
			})
			return resolve("https://telegra.ph" + data.data[0].src)
		} catch (err) {
			return reject(new Error(String(err)))
		}
	})
}

async function UploadFileUgu (input) {
	return new Promise (async (resolve, reject) => {
			const form = new BodyForm();
			form.append("files[]", fs.createReadStream(input))
			await axios({
				url: "https://uguu.se/upload.php",
				method: "POST",
				headers: {
					"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
					...form.getHeaders()
				},
				data: form
			}).then((data) => {
				resolve(data.data.files[0])
			}).catch((err) => reject(err))
	})
}

async function webp2mp4File(path) {
const FormData = require('form-data');  // Use form-data package
    try {
        // Verify FormData is properly imported
        console.log('FormData constructor:', FormData);
        
        const form = new FormData();
        console.log('Created form instance:', form);
        
        // Add empty URL field
        form.append('new-image-url', '');
        console.log('Added new-image-url field');
        
        // Add file stream
        const readStream = fs.createReadStream(path);
        console.log('Created read stream:', readStream);
        
        form.append('new-image', readStream);
        console.log('Added file to form');
        
        // First request
        const response = await axios.post('https://s6.ezgif.com/webp-to-mp4', form, {
            headers: {
                ...form.getHeaders()
            }
        });
        
        const $ = cheerio.load(response.data);
        const fileInput = $('input[name="file"]');
        console.log('Found file input:', fileInput.length > 0 ? 'yes' : 'no');
        
        // Second request
        const bodyFormThen = new FormData();
        const fileValue = fileInput.attr('value');
        console.log('File value:', fileValue);
        
        bodyFormThen.append('file', fileValue);
        bodyFormThen.append('convert', "Convert WebP to MP4!");
        
        const finalResponse = await axios.post(`https://ezgif.com/webp-to-mp4/${fileValue}`, bodyFormThen, {
            headers: {
                ...bodyFormThen.getHeaders()
            }
        });
        
        const $$ = cheerio.load(finalResponse.data);
        const result = 'https:' + $$('#output > p.outfile > video > source').attr('src');
        
        return {
            status: true,
            message: "Success",
            result: result
        };
    } catch (error) {
        console.error('Error details:', error.message);
        throw error;
    }
}
async function floNime(medianya, options = {}) {
const { ext } = await fromBuffer(medianya) || options.ext
        var form = new BodyForm()
        form.append('file', medianya, 'tmp.'+ext)
        let jsonnya = await fetch('https://flonime.my.id/upload', {
                method: 'POST',
                body: form
        })
        .then((response) => response.json())
        return jsonnya
}

module.exports = { TelegraPh, UploadFileUgu, webp2mp4File, floNime }
let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})