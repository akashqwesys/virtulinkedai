const fs = require('fs');
const pdf = require('pdf-parse');

const pdfPath = 'C:\\Users\\deepj\\Downloads\\Implementation Plan.pdf';
const outputPath = 'C:\\Users\\deepj\\VirtualLinkedin\\virtulinkedAI\\plan_debug.txt';

async function extract() {
    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const data = await pdf(dataBuffer);
        fs.writeFileSync(outputPath, data.text, 'utf8');
        console.log('Success');
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

extract();
